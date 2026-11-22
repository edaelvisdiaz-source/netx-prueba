import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV, Env } from '../config/env';
import { soloFecha } from '../terminos/dias-habiles';
import { ActuacionFuente, Fuente, FuenteError, ProcesoFuente } from './fuente';

export const HTTP_FETCH = Symbol('HTTP_FETCH');
export type FetchFn = typeof fetch;

const MAX_PAGINAS_PROCESOS = 5;
const MAX_PAGINAS_ACTUACIONES = 30;
const HTTP_NO_ENCONTRADO = 404;
const MAX_BYTES_RESPUESTA = 2_000_000;

const paginacion = z.object({ cantidadPaginas: z.number().int().nonnegative() }).passthrough();

const respuestaProcesos = z
  .object({
    procesos: z.array(
      z
        .object({
          idProceso: z.number().int(),
          fechaProceso: z.string().nullish(),
          despacho: z.string().nullish(),
          sujetosProcesales: z.string().nullish(),
          esPrivado: z.boolean().nullish(),
        })
        .passthrough(),
    ),
    paginacion: paginacion.nullish(),
  })
  .passthrough();

const respuestaActuaciones = z
  .object({
    actuaciones: z.array(
      z
        .object({
          idRegActuacion: z.number().int(),
          fechaActuacion: z.string(),
          actuacion: z.string(),
          anotacion: z.string().nullish(),
          fechaInicial: z.string().nullish(),
          fechaFinal: z.string().nullish(),
          fechaRegistro: z.string().nullish(),
        })
        .passthrough(),
    ),
    paginacion: paginacion.nullish(),
  })
  .passthrough();

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/**
 * Consulta de Procesos Nacional Unificada de la Rama Judicial. Es la misma consulta publica por
 * numero de radicacion que ofrece la pagina, sin inicio de sesion. Las peticiones salen de a una
 * y separadas por una pausa para no cargar el servicio.
 */
@Injectable()
export class RamaJudicialFuente extends Fuente {
  readonly id = 'RAMA_JUDICIAL_CPNU' as const;
  private cola: Promise<unknown> = Promise.resolve();
  private ultimaPeticion = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly fetchFn: FetchFn,
  ) {
    super();
  }

  async buscarProcesos(radicado: string): Promise<ReadonlyArray<ProcesoFuente>> {
    const procesos: ProcesoFuente[] = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS_PROCESOS; pagina += 1) {
      const consulta = new URLSearchParams({ numero: radicado, SoloActivos: 'false', pagina: String(pagina) });
      const cuerpo = await this.obtener(`/Procesos/Consulta/NumeroRadicacion?${consulta.toString()}`);
      if (cuerpo === null) break;
      const datos = this.validar(respuestaProcesos, cuerpo);
      procesos.push(
        ...datos.procesos.map((proceso) => ({
          idFuente: String(proceso.idProceso),
          despacho: proceso.despacho?.trim() || null,
          sujetos: proceso.sujetosProcesales?.trim() || null,
          fechaRadicacion: soloFecha(proceso.fechaProceso),
          privado: proceso.esPrivado === true,
        })),
      );
      if (pagina >= (datos.paginacion?.cantidadPaginas ?? 1)) break;
    }
    return procesos;
  }

  async listarActuaciones(idFuente: string): Promise<ReadonlyArray<ActuacionFuente>> {
    if (!/^\d+$/.test(idFuente)) {
      throw new FuenteError('Identificador de proceso invalido', 'RESPUESTA_INVALIDA');
    }
    const actuaciones: ActuacionFuente[] = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS_ACTUACIONES; pagina += 1) {
      const cuerpo = await this.obtener(`/Proceso/Actuaciones/${idFuente}?pagina=${pagina}`);
      if (cuerpo === null) break;
      const datos = this.validar(respuestaActuaciones, cuerpo);
      for (const actuacion of datos.actuaciones) {
        const fecha = soloFecha(actuacion.fechaActuacion);
        if (fecha === null) {
          throw new FuenteError('La fuente envio una actuacion sin fecha valida', 'RESPUESTA_INVALIDA');
        }
        actuaciones.push({
          clave: String(actuacion.idRegActuacion),
          fecha,
          titulo: actuacion.actuacion.trim(),
          anotacion: actuacion.anotacion?.trim() || null,
          fechaInicioTermino: soloFecha(actuacion.fechaInicial),
          fechaFinTermino: soloFecha(actuacion.fechaFinal),
          fechaRegistro: soloFecha(actuacion.fechaRegistro),
        });
      }
      if (pagina >= (datos.paginacion?.cantidadPaginas ?? 1)) break;
    }
    return actuaciones;
  }

  private validar<T>(esquema: z.ZodType<T>, cuerpo: unknown): T {
    const resultado = esquema.safeParse(cuerpo);
    if (!resultado.success) {
      const campo = resultado.error.issues[0]?.path.join('.') ?? 'respuesta';
      throw new FuenteError(`La fuente cambio su formato (campo ${campo})`, 'RESPUESTA_INVALIDA');
    }
    return resultado.data;
  }

  /** Encola la peticion para que solo haya una en curso y respeta la pausa minima. */
  private obtener(ruta: string): Promise<unknown | null> {
    const turno = this.cola.then(() => this.pedir(ruta));
    this.cola = turno.catch(() => undefined);
    return turno;
  }

  private async pedir(ruta: string): Promise<unknown | null> {
    const faltante = this.ultimaPeticion + this.env.RAMA_MIN_INTERVAL_MS - Date.now();
    if (faltante > 0) await esperar(faltante);
    this.ultimaPeticion = Date.now();

    let respuesta: Response;
    try {
      respuesta = await this.fetchFn(`${this.env.RAMA_BASE_URL}${ruta}`, {
        headers: { accept: 'application/json', 'user-agent': this.env.CONTACTO_USER_AGENT },
        signal: AbortSignal.timeout(this.env.RAMA_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      const motivo = error instanceof Error ? error.name : 'Error';
      throw new FuenteError(`No se pudo conectar con la Rama Judicial (${motivo})`, 'NO_DISPONIBLE');
    }
    if (respuesta.status === HTTP_NO_ENCONTRADO) return null;
    if (!respuesta.ok) {
      throw new FuenteError(`La Rama Judicial respondio ${respuesta.status}`, 'NO_DISPONIBLE');
    }
    let texto: string;
    try {
      texto = await respuesta.text();
    } catch {
      throw new FuenteError('La Rama Judicial corto la respuesta', 'NO_DISPONIBLE');
    }
    if (texto.length > MAX_BYTES_RESPUESTA) {
      throw new FuenteError('La Rama Judicial envio una respuesta demasiado grande', 'RESPUESTA_INVALIDA');
    }
    try {
      return JSON.parse(texto) as unknown;
    } catch {
      throw new FuenteError('La Rama Judicial no respondio en el formato esperado', 'RESPUESTA_INVALIDA');
    }
  }
}
