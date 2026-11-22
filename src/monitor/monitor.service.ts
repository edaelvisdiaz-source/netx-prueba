import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { ENV, Env } from '../config/env';
import { ActuacionFuente, FuenteError } from '../fuentes/fuente';
import { FuentesRegistry } from '../fuentes/fuentes.registry';
import { EventosService } from '../notificaciones/eventos.service';
import { FechaISO, hoyEnColombia } from '../terminos/dias-habiles';
import { calcularTerminosTutela } from '../terminos/tutela';
import { Actuacion } from '../tramites/actuacion.entity';
import { clasificarActuacion } from '../tramites/clasificacion';
import { Tramite } from '../tramites/tramite.entity';
import { TramitesService } from '../tramites/tramites.service';

const MS_HORA = 3_600_000;
const MS_MINUTO = 60_000;
const RESERVA_MINUTOS = 15;
const ESPERA_BASE_ERROR_MINUTOS = 15;
const ERRORES_PARA_AVISAR = 5;
const VARIACION_INTERVALO = 0.1;
const LARGO_MAXIMO_NOTA = 400;

type ActuacionEncontrada = ActuacionFuente & { readonly despacho: string | null };

export interface ResultadoRevision {
  readonly tramiteId: string;
  readonly encontrado: boolean;
  readonly primeraSincronizacion: boolean;
  readonly actuacionesNuevas: number;
  readonly error: string | null;
}

function maximo(fechas: ReadonlyArray<FechaISO | null>): FechaISO | null {
  return fechas.reduce<FechaISO | null>(
    (mayor, fecha) => (fecha !== null && (mayor === null || fecha > mayor) ? fecha : mayor),
    null,
  );
}

function minimo(fechas: ReadonlyArray<FechaISO | null>): FechaISO | null {
  return fechas.reduce<FechaISO | null>(
    (menor, fecha) => (fecha !== null && (menor === null || fecha < menor) ? fecha : menor),
    null,
  );
}

function notaSugerida(actuacion: ActuacionEncontrada): string {
  const detalle = actuacion.anotacion ? ` ${actuacion.anotacion}` : '';
  return `Radika: actuacion del ${actuacion.fecha} - ${actuacion.titulo}.${detalle}`.slice(0, LARGO_MAXIMO_NOTA);
}

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Tramite) private readonly tramites: Repository<Tramite>,
    @InjectRepository(Actuacion) private readonly actuaciones: Repository<Actuacion>,
    @Inject(ENV) private readonly env: Env,
    private readonly tramitesService: TramitesService,
    private readonly fuentes: FuentesRegistry,
    private readonly eventos: EventosService,
  ) {}

  /** Consulta la fuente, guarda las actuaciones que no estaban y deja los avisos para el CRM. */
  async revisar(tramiteId: string): Promise<ResultadoRevision> {
    const tramite = await this.tramitesService.obtener(tramiteId);
    if (tramite.fuente === 'MANUAL') {
      throw new BadRequestException('Este tramite es de seguimiento manual; aun no tiene consulta automatica');
    }
    const fuente = this.fuentes.obtener(tramite.fuente);
    const primera = tramite.sincronizadoAt === null;
    try {
      const procesos = (await fuente.buscarProcesos(tramite.radicado)).filter((proceso) => !proceso.privado);
      const encontradas: ActuacionEncontrada[] = [];
      for (const proceso of procesos) {
        const lista = await fuente.listarActuaciones(proceso.idFuente);
        encontradas.push(
          ...lista.map((actuacion) => ({
            ...actuacion,
            clave: `${proceso.idFuente}:${actuacion.clave}`,
            despacho: proceso.despacho,
          })),
        );
      }
      if (procesos.length === 0) {
        await this.tramites.update(
          { id: tramite.id },
          {
            ultimaRevisionAt: new Date(),
            proximaRevisionAt: this.proximaRevision(),
            ultimoError: 'La fuente aun no muestra este radicado',
            erroresConsecutivos: 0,
          },
        );
        return { tramiteId, encontrado: false, primeraSincronizacion: primera, actuacionesNuevas: 0, error: null };
      }
      const nuevas = await this.guardar(tramite, procesos, encontradas, primera);
      return { tramiteId, encontrado: true, primeraSincronizacion: primera, actuacionesNuevas: nuevas, error: null };
    } catch (error) {
      if (!(error instanceof FuenteError)) throw error;
      await this.registrarError(tramite, error);
      return { tramiteId, encontrado: false, primeraSincronizacion: primera, actuacionesNuevas: 0, error: error.message };
    }
  }

  /** Toma los tramites a los que ya les toca revision y los revisa uno por uno. */
  async revisarPendientes(): Promise<number> {
    const filas: unknown = await this.dataSource.query(
      `UPDATE tramites SET proxima_revision_at = now() + make_interval(mins => $2)
       WHERE id IN (
         SELECT id FROM tramites
         WHERE estado = 'ACTIVO' AND fuente <> 'MANUAL' AND proxima_revision_at <= now()
         ORDER BY proxima_revision_at LIMIT $1 FOR UPDATE SKIP LOCKED
       ) RETURNING id`,
      [this.env.REVISION_LOTE, RESERVA_MINUTOS],
    );
    const reservados = (Array.isArray(filas) && Array.isArray(filas[0]) ? filas[0] : filas) as Array<{ id: string }>;
    for (const { id } of reservados) {
      try {
        await this.revisar(id);
      } catch (error) {
        this.logger.error(`Fallo la revision del tramite ${id}: ${error instanceof Error ? error.message : 'error'}`);
      }
    }
    return reservados.length;
  }

  /** Deja un aviso por cada termino de tutela que esta por vencer o ya vencio. */
  async avisarTerminos(hoy: FechaISO = hoyEnColombia()): Promise<number> {
    const tutelas = await this.tramites.find({
      where: { tipo: 'TUTELA', estado: 'ACTIVO', sincronizadoAt: Not(IsNull()) },
    });
    if (tutelas.length === 0) return 0;
    const actuaciones = await this.actuaciones.find({
      where: { tramiteId: In(tutelas.map((tutela) => tutela.id)), categoria: In(['FALLO', 'IMPUGNACION']) },
      select: { tramiteId: true, fecha: true, categoria: true },
    });
    let avisos = 0;
    for (const tutela of tutelas) {
      const terminos = calcularTerminosTutela({
        fechaRadicacion: tutela.fechaRadicacion,
        actuaciones: actuaciones.filter((actuacion) => actuacion.tramiteId === tutela.id),
        hoy,
      });
      for (const termino of terminos) {
        const porVencer = termino.estado === 'POR_VENCER';
        const falloVencido = termino.estado === 'VENCIDO' && termino.clave === 'FALLO_PRIMERA_INSTANCIA';
        if (!porVencer && !falloVencido) continue;
        await this.eventos.registrar(this.dataSource.manager, {
          tramite: tutela,
          tipo: porVencer ? 'TERMINO_POR_VENCER' : 'TERMINO_VENCIDO',
          datos: { termino },
          claveDedupe: `termino:${tutela.id}:${termino.clave}:${termino.estado}:${termino.fechaLimite}`,
        });
        avisos += 1;
      }
    }
    return avisos;
  }

  private async guardar(
    tramite: Tramite,
    procesos: ReadonlyArray<{ despacho: string | null; sujetos: string | null; fechaRadicacion: FechaISO | null }>,
    encontradas: ReadonlyArray<ActuacionEncontrada>,
    primera: boolean,
  ): Promise<number> {
    const existentes = await this.actuaciones.find({ where: { tramiteId: tramite.id }, select: { claveFuente: true } });
    const conocidas = new Set(existentes.map((actuacion) => actuacion.claveFuente));
    const nuevas = encontradas.filter((actuacion) => !conocidas.has(actuacion.clave));
    const despachos = [...new Set(procesos.map((proceso) => proceso.despacho).filter(Boolean))];
    const ahora = new Date();

    await this.dataSource.transaction(async (em) => {
      if (nuevas.length > 0) {
        await em
          .createQueryBuilder()
          .insert()
          .into(Actuacion)
          .values(
            nuevas.map((actuacion) => ({
              tramiteId: tramite.id,
              claveFuente: actuacion.clave,
              despacho: actuacion.despacho,
              fecha: actuacion.fecha,
              titulo: actuacion.titulo,
              anotacion: actuacion.anotacion,
              fechaInicioTermino: actuacion.fechaInicioTermino,
              fechaFinTermino: actuacion.fechaFinTermino,
              fechaRegistro: actuacion.fechaRegistro,
              categoria: clasificarActuacion(actuacion.titulo, actuacion.anotacion),
            })),
          )
          .orIgnore()
          .execute();
      }
      await em.update(
        Tramite,
        { id: tramite.id },
        {
          despacho: despachos.join(' | ') || null,
          sujetos: procesos.find((proceso) => proceso.sujetos)?.sujetos ?? null,
          fechaRadicacion: minimo(procesos.map((proceso) => proceso.fechaRadicacion)),
          ultimaActuacionFecha: maximo([tramite.ultimaActuacionFecha, ...encontradas.map((actuacion) => actuacion.fecha)]),
          ultimaRevisionAt: ahora,
          sincronizadoAt: tramite.sincronizadoAt ?? ahora,
          proximaRevisionAt: this.proximaRevision(),
          ultimoError: null,
          erroresConsecutivos: 0,
        },
      );
      if (primera) {
        await this.eventos.registrar(em, {
          tramite,
          tipo: 'TRAMITE_SINCRONIZADO',
          datos: { actuaciones: nuevas.length, despacho: despachos.join(' | ') || null },
        });
        return;
      }
      for (const actuacion of nuevas) {
        await this.eventos.registrar(em, {
          tramite,
          tipo: 'ACTUACION_NUEVA',
          claveDedupe: `actuacion:${tramite.id}:${actuacion.clave}`,
          datos: {
            actuacion: {
              fecha: actuacion.fecha,
              titulo: actuacion.titulo,
              anotacion: actuacion.anotacion,
              despacho: actuacion.despacho,
              categoria: clasificarActuacion(actuacion.titulo, actuacion.anotacion),
            },
            notaSugerida: notaSugerida(actuacion),
          },
        });
      }
    });
    return nuevas.length;
  }

  private async registrarError(tramite: Tramite, error: FuenteError): Promise<void> {
    const errores = tramite.erroresConsecutivos + 1;
    const esperaMs = Math.min(
      this.env.REVISION_INTERVALO_HORAS * MS_HORA,
      ESPERA_BASE_ERROR_MINUTOS * MS_MINUTO * 2 ** (errores - 1),
    );
    await this.dataSource.transaction(async (em) => {
      await em.update(
        Tramite,
        { id: tramite.id },
        {
          ultimaRevisionAt: new Date(),
          proximaRevisionAt: new Date(Date.now() + esperaMs),
          ultimoError: error.message,
          erroresConsecutivos: errores,
        },
      );
      if (errores === ERRORES_PARA_AVISAR) {
        await this.eventos.registrar(em, {
          tramite,
          tipo: 'ERROR_FUENTE',
          datos: { mensaje: error.message, codigo: error.codigo, erroresConsecutivos: errores },
        });
      }
    });
  }

  private proximaRevision(): Date {
    const variacion = 1 + (Math.random() * 2 - 1) * VARIACION_INTERVALO;
    return new Date(Date.now() + this.env.REVISION_INTERVALO_HORAS * MS_HORA * variacion);
  }
}
