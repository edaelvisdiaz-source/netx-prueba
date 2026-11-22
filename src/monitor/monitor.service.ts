import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { ENV, Env } from '../config/env';
import { ActuacionFuente, FuenteError } from '../fuentes/fuente';
import { FuentesRegistry } from '../fuentes/fuentes.registry';
import { EventosService } from '../notificaciones/eventos.service';
import { ResumenActuacion, Resumidor } from '../resumen/resumidor';
import { FechaISO, hoyEnColombia } from '../terminos/dias-habiles';
import { calcularTerminosTutela } from '../terminos/tutela';
import { randomUUID } from 'node:crypto';
import { Actuacion } from '../tramites/actuacion.entity';
import { esRemitenteConfiable, extraerPistas, PistasRadicado, tituloDesdeAsunto } from '../correo/analizar-correo';
import { CorreoEntrante, RegistrarActuacion } from '../tramites/dto';
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
const MAX_PROCESOS_POR_RADICADO = 20;
const LARGO_MAXIMO_ANOTACION = 2000;

type ActuacionEncontrada = ActuacionFuente & { readonly despacho: string | null };

export type ResultadoCorreo =
  | { readonly vinculado: true; readonly tramiteId: string; readonly duplicado: boolean }
  | { readonly vinculado: false; readonly motivo: 'REMITENTE_NO_CONFIABLE' | 'SIN_RADICADO' | 'SIN_TRAMITE' | 'AMBIGUO' };

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
    private readonly resumidor: Resumidor,
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
      const todos = await fuente.buscarProcesos(tramite.radicado);
      const procesos = todos.filter((proceso) => !proceso.privado).slice(0, MAX_PROCESOS_POR_RADICADO);
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
            ultimoError:
              todos.length > 0
                ? 'La fuente marca este proceso como reservado; no publica sus actuaciones'
                : 'La fuente aun no muestra este radicado',
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

  /**
   * Registra una actuacion que alguien reviso a mano (tramites sin consulta automatica o fuentes
   * que piden verificacion humana). Produce el mismo aviso que una actuacion detectada sola.
   */
  async registrarManual(tramiteId: string, datos: RegistrarActuacion): Promise<Actuacion> {
    const tramite = await this.tramitesService.obtener(tramiteId);
    return this.registrarExterna(tramite, 'MANUAL', {
      clave: `manual:${randomUUID()}`,
      fecha: datos.fecha,
      titulo: datos.titulo,
      anotacion: datos.anotacion ?? null,
      fechaInicioTermino: null,
      fechaFinTermino: null,
      fechaRegistro: hoyEnColombia(),
      despacho: tramite.despacho,
    });
  }

  /**
   * Convierte un correo de un despacho en una actuacion del tramite al que pertenece. El tramite
   * se ubica por el radicado que aparece en el asunto, los adjuntos o el texto.
   */
  async registrarCorreo(correo: CorreoEntrante): Promise<ResultadoCorreo> {
    if (!esRemitenteConfiable(correo.from, this.env.CORREO_DOMINIOS_CONFIABLES)) {
      return { vinculado: false, motivo: 'REMITENTE_NO_CONFIABLE' };
    }
    const pistas = extraerPistas([correo.subject, ...(correo.adjuntos ?? []), correo.texto ?? ''].join('\n'));
    const tramite = await this.buscarPorPistas(pistas);
    if (tramite === 'AMBIGUO' || tramite === 'SIN_RADICADO' || tramite === 'SIN_TRAMITE') {
      return { vinculado: false, motivo: tramite };
    }
    const clave = `correo:${correo.messageId}`;
    const yaExiste = await this.actuaciones.existsBy({ tramiteId: tramite.id, claveFuente: clave });
    if (yaExiste) return { vinculado: true, tramiteId: tramite.id, duplicado: true };
    const adjuntos = correo.adjuntos?.length ? ` Adjuntos: ${correo.adjuntos.join('; ')}.` : '';
    await this.registrarExterna(tramite, 'CORREO', {
      clave,
      fecha: hoyEnColombia(new Date(correo.date)),
      titulo: tituloDesdeAsunto(correo.subject),
      anotacion: `Notificado por correo desde ${correo.fromNombre ?? correo.from}.${adjuntos}`.slice(0, LARGO_MAXIMO_ANOTACION),
      fechaInicioTermino: null,
      fechaFinTermino: null,
      fechaRegistro: hoyEnColombia(),
      despacho: correo.fromNombre ?? tramite.despacho,
    });
    return { vinculado: true, tramiteId: tramite.id, duplicado: false };
  }

  private async buscarPorPistas(pistas: PistasRadicado): Promise<Tramite | 'AMBIGUO' | 'SIN_RADICADO' | 'SIN_TRAMITE'> {
    if (pistas.completos.length + pistas.prefijos.length + pistas.anoConsecutivo.length === 0) return 'SIN_RADICADO';
    const busquedas: Array<() => Promise<Tramite[]>> = [
      () => (pistas.completos.length ? this.tramites.findBy({ radicado: In([...pistas.completos]) }) : Promise.resolve([])),
      () =>
        pistas.prefijos.length
          ? this.tramites.createQueryBuilder('t').where('left(t.radicado, 21) IN (:...prefijos)', { prefijos: pistas.prefijos }).getMany()
          : Promise.resolve([]),
      () =>
        pistas.anoConsecutivo.length
          ? this.tramites
              .createQueryBuilder('t')
              .where(`t.fuente = 'RAMA_JUDICIAL_CPNU' AND substring(t.radicado from 13 for 9) IN (:...claves)`, { claves: pistas.anoConsecutivo })
              .getMany()
          : Promise.resolve([]),
    ];
    for (const buscar of busquedas) {
      const hallados = await buscar();
      if (hallados.length === 1) return hallados[0];
      if (hallados.length > 1) return 'AMBIGUO';
    }
    return 'SIN_TRAMITE';
  }

  private async registrarExterna(tramite: Tramite, origen: 'MANUAL' | 'CORREO', encontrada: ActuacionEncontrada): Promise<Actuacion> {
    const tramiteId = tramite.id;
    const existentes = await this.actuaciones.find({
      where: { tramiteId },
      select: { fecha: true, titulo: true },
      order: { fecha: 'DESC' },
    });
    const categoria = clasificarActuacion(encontrada.titulo, null);
    const resumen = (await this.resumir(tramite, [encontrada], existentes)).get(encontrada.clave) ?? null;
    return this.dataSource.transaction(async (em) => {
      const guardada = await em.save(
        em.create(Actuacion, {
          tramiteId,
          claveFuente: encontrada.clave,
          despacho: encontrada.despacho,
          fecha: encontrada.fecha,
          titulo: encontrada.titulo,
          anotacion: encontrada.anotacion,
          fechaInicioTermino: null,
          fechaFinTermino: null,
          fechaRegistro: encontrada.fechaRegistro,
          categoria,
          resumen,
        }),
      );
      await em.update(
        Tramite,
        { id: tramiteId },
        { ultimaActuacionFecha: maximo([tramite.ultimaActuacionFecha, encontrada.fecha]) },
      );
      await this.eventos.registrar(em, {
        tramite,
        tipo: 'ACTUACION_NUEVA',
        claveDedupe: `actuacion:${tramiteId}:${encontrada.clave}`,
        datos: {
          actuacion: { fecha: encontrada.fecha, titulo: encontrada.titulo, anotacion: encontrada.anotacion, despacho: encontrada.despacho, categoria },
          resumen,
          notaSugerida: resumen ? `Radika: ${resumen.resumen}`.slice(0, LARGO_MAXIMO_NOTA) : notaSugerida(encontrada),
          origen,
        },
      });
      return guardada;
    });
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

  /** Deja un aviso por cada termino de tutela por vencer o vencido. Devuelve cuantos avisos nuevos creo. */
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
        const nuevo = await this.eventos.registrar(this.dataSource.manager, {
          tramite: tutela,
          tipo: porVencer ? 'TERMINO_POR_VENCER' : 'TERMINO_VENCIDO',
          datos: { termino },
          claveDedupe: `termino:${tutela.id}:${termino.clave}:${termino.estado}:${termino.fechaLimite}`,
        });
        if (nuevo) avisos += 1;
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
    const existentes = await this.actuaciones.find({
      where: { tramiteId: tramite.id },
      select: { claveFuente: true, fecha: true, titulo: true },
      order: { fecha: 'DESC' },
    });
    const conocidas = new Set(existentes.map((actuacion) => actuacion.claveFuente));
    const nuevas = encontradas.filter((actuacion) => !conocidas.has(actuacion.clave));
    const despachos = [...new Set(procesos.map((proceso) => proceso.despacho).filter(Boolean))];
    const ahora = new Date();
    // Solo se resumen las novedades: el historial de la primera sincronizacion no genera avisos.
    const resumenes = primera ? new Map<string, ResumenActuacion>() : await this.resumir(tramite, nuevas, existentes);

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
              resumen: resumenes.get(actuacion.clave) ?? null,
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
          claveDedupe: `sincronizado:${tramite.id}`,
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
            resumen: resumenes.get(actuacion.clave) ?? null,
            notaSugerida: resumenes.get(actuacion.clave)?.resumen
              ? `Radika: ${resumenes.get(actuacion.clave)?.resumen}`.slice(0, LARGO_MAXIMO_NOTA)
              : notaSugerida(actuacion),
          },
        });
      }
    });
    return nuevas.length;
  }

  /** Pide el resumen de cada novedad, de la mas antigua a la mas reciente. Un fallo no detiene la revision. */
  private async resumir(
    tramite: Tramite,
    nuevas: ReadonlyArray<ActuacionEncontrada>,
    existentes: ReadonlyArray<{ fecha: string; titulo: string }>,
  ): Promise<Map<string, ResumenActuacion>> {
    const resumenes = new Map<string, ResumenActuacion>();
    const enOrden = [...nuevas].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-this.env.RESUMENES_POR_REVISION);
    let anteriores = existentes.map(({ fecha, titulo }) => ({ fecha, titulo }));
    for (const actuacion of this.env.RESUMENES_POR_REVISION > 0 ? enOrden : []) {
      const resumen = await this.resumidor.resumir({
        tipoTramite: tramite.tipo,
        despacho: actuacion.despacho,
        fecha: actuacion.fecha,
        titulo: actuacion.titulo,
        anotacion: actuacion.anotacion,
        categoria: clasificarActuacion(actuacion.titulo, actuacion.anotacion),
        anteriores,
      });
      if (resumen) resumenes.set(actuacion.clave, resumen);
      anteriores = [{ fecha: actuacion.fecha, titulo: actuacion.titulo }, ...anteriores];
    }
    return resumenes;
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
          claveDedupe: `error:${tramite.id}:${hoyEnColombia()}`,
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
