import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ENV, Env } from '../config/env';
import { MonitorService, ResultadoCorreo } from '../monitor/monitor.service';
import { esRemitenteConfiable } from './analizar-correo';
import { Buzon, CorreoPendiente } from './buzon.entity';
import { CorreoLeido, LectorBuzon, LecturaCarpeta, PuntoDeLectura } from './lector-buzon';

const CORREOS_POR_TANDA = 200;
const PENDIENTES_POR_PAGINA = 100;
/** Lo mismo que acepta el esquema de un correo entrante. */
const TEXTO_MAXIMO = 50_000;
/** Cada apertura es una conexion al servidor de correo: una avalancha de correos no debe saturarlo. */
const APERTURAS_POR_SINCRONIZACION = 20;

export interface ResultadoBuzon {
  readonly leidos: number;
  readonly vinculados: number;
  readonly pendientes: number;
}

const SIN_NOVEDAD: ResultadoBuzon = { leidos: 0, vinculados: 0, pendientes: 0 };

/** Vigila el buzon y entrega a Radika los correos de los despachos. */
@Injectable()
export class BuzonService {
  private readonly logger = new Logger(BuzonService.name);
  private aperturas = 0;

  constructor(
    @InjectRepository(Buzon) private readonly buzones: Repository<Buzon>,
    @InjectRepository(CorreoPendiente) private readonly pendientes: Repository<CorreoPendiente>,
    @Inject(ENV) private readonly env: Env,
    private readonly lector: LectorBuzon,
    private readonly monitor: MonitorService,
  ) {}

  async sincronizar(): Promise<ResultadoBuzon> {
    const direccion = this.lector.buzon;
    if (direccion === null) return SIN_NOVEDAD;
    const estados = await this.buzones.findBy({ direccion });
    const puntos = new Map(estados.map((estado) => [estado.carpeta, { uidValidity: estado.uidValidity, ultimoUid: estado.ultimoUid }]));
    const lecturas = await this.lector.leer(puntos, CORREOS_POR_TANDA);

    this.aperturas = 0;
    let total: ResultadoBuzon = SIN_NOVEDAD;
    for (const lectura of lecturas) {
      const parcial = await this.procesarCarpeta(direccion, lectura, puntos.get(lectura.carpeta));
      total = { leidos: total.leidos + parcial.leidos, vinculados: total.vinculados + parcial.vinculados, pendientes: total.pendientes + parcial.pendientes };
    }
    return total;
  }

  private async procesarCarpeta(direccion: string, lectura: LecturaCarpeta, punto: PuntoDeLectura | undefined): Promise<ResultadoBuzon> {
    const { carpeta } = lectura;
    // Primera vez (o el servidor renumero la carpeta): se toma el punto de partida sin procesar el historial.
    if (!punto || punto.uidValidity !== lectura.uidValidity) {
      await this.buzones.save({ direccion, carpeta, uidValidity: lectura.uidValidity, ultimoUid: lectura.uidMaximo });
      this.logger.log(`Buzon ${direccion}, carpeta ${carpeta}: se leera a partir del correo ${lectura.uidMaximo + 1}`);
      return SIN_NOVEDAD;
    }

    let vinculados = 0;
    let pendientes = 0;
    let ultimoUid = punto.ultimoUid;
    for (const correo of lectura.correos) {
      if (esRemitenteConfiable(correo.from, this.env.CORREO_DOMINIOS_CONFIABLES)) {
        const resultado = await this.registrar(carpeta, correo);
        if (resultado.vinculado) {
          vinculados += 1;
        } else if (resultado.motivo !== 'REMITENTE_NO_CONFIABLE') {
          pendientes += await this.dejarPendiente(direccion, carpeta, correo, resultado.motivo, resultado.radicadoSugerido ?? null);
        }
      }
      ultimoUid = correo.uid;
      await this.buzones.update({ direccion, carpeta }, { ultimoUid });
    }
    // Si el tramo leido no traia correos (por ejemplo, fueron borrados), se avanza igual.
    const alcanzado = Math.min(lectura.uidMaximo, punto.ultimoUid + CORREOS_POR_TANDA);
    if (alcanzado > ultimoUid) await this.buzones.update({ direccion, carpeta }, { ultimoUid: alcanzado });
    return { leidos: lectura.correos.length, vinculados, pendientes };
  }

  /** Busca el radicado en el asunto y los nombres de adjuntos; solo si no aparece, abre el correo. */
  private async registrar(carpeta: string, correo: CorreoLeido): Promise<ResultadoCorreo> {
    const entrante = {
      messageId: correo.messageId,
      from: correo.from,
      fromNombre: correo.fromNombre ?? undefined,
      subject: correo.subject,
      date: correo.date,
      adjuntos: [...correo.adjuntos],
    };
    const porEncabezados = await this.monitor.registrarCorreo(entrante);
    if (porEncabezados.vinculado || porEncabezados.motivo !== 'SIN_RADICADO') return porEncabezados;
    if (this.aperturas >= APERTURAS_POR_SINCRONIZACION) return porEncabezados;
    this.aperturas += 1;
    let texto: string;
    try {
      texto = (await this.lector.leerContenido(carpeta, correo.uid)).slice(0, TEXTO_MAXIMO);
    } catch (error) {
      this.logger.warn(`No se pudo abrir el correo ${correo.uid} de ${carpeta}: ${error instanceof Error ? error.message : 'error'}`);
      return porEncabezados;
    }
    return texto.trim() ? this.monitor.registrarCorreo({ ...entrante, texto }) : porEncabezados;
  }

  /** Devuelve 1 si el correo quedo pendiente por primera vez (el mismo correo puede estar en dos carpetas). */
  private async dejarPendiente(direccion: string, carpeta: string, correo: CorreoLeido, motivo: string, radicadoSugerido: string | null): Promise<number> {
    const insercion = await this.pendientes
      .createQueryBuilder()
      .insert()
      .values({
        buzon: direccion,
        carpeta,
        messageId: correo.messageId,
        remitente: correo.from,
        remitenteNombre: correo.fromNombre,
        asunto: correo.subject,
        fecha: new Date(correo.date),
        motivo,
        radicadoSugerido,
      })
      .orIgnore()
      .returning('id')
      .execute();
    return (insercion.raw as unknown[]).length;
  }

  listarPendientes(): Promise<CorreoPendiente[]> {
    return this.pendientes.find({ order: { fecha: 'DESC' }, take: PENDIENTES_POR_PAGINA });
  }

  async descartarPendiente(id: string): Promise<void> {
    const resultado = await this.pendientes.delete({ id });
    if (!resultado.affected) throw new NotFoundException('Correo pendiente no encontrado');
  }
}
