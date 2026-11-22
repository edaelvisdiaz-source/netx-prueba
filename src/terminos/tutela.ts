import { CategoriaActuacion } from '../tramites/tipos';
import { diasHabilesEntre, FechaISO, sumarDiasHabiles } from './dias-habiles';

/** Decreto 2591 de 1991, articulos 29 y 31. */
const DIAS_FALLO_PRIMERA_INSTANCIA = 10;
const DIAS_IMPUGNACION = 3;
const DIAS_AVISO_PREVIO = 2;

export type ClaveTermino = 'FALLO_PRIMERA_INSTANCIA' | 'IMPUGNACION';
export type EstadoTermino = 'EN_CURSO' | 'POR_VENCER' | 'VENCIDO' | 'CUMPLIDO';

export interface Termino {
  readonly clave: ClaveTermino;
  readonly descripcion: string;
  readonly fechaBase: FechaISO;
  readonly fechaLimite: FechaISO;
  readonly diasHabilesRestantes: number;
  readonly estado: EstadoTermino;
}

export interface ActuacionParaTerminos {
  readonly fecha: FechaISO;
  readonly categoria: CategoriaActuacion;
}

export interface DatosTutela {
  readonly fechaRadicacion: FechaISO | null;
  readonly actuaciones: ReadonlyArray<ActuacionParaTerminos>;
  readonly hoy: FechaISO;
}

function estadoSegunPlazo(cumplido: boolean, restantes: number): EstadoTermino {
  if (cumplido) return 'CUMPLIDO';
  if (restantes < 0) return 'VENCIDO';
  return restantes <= DIAS_AVISO_PREVIO ? 'POR_VENCER' : 'EN_CURSO';
}

function primera(actuaciones: ReadonlyArray<ActuacionParaTerminos>, categoria: CategoriaActuacion) {
  return actuaciones
    .filter((actuacion) => actuacion.categoria === categoria)
    .reduce<ActuacionParaTerminos | null>(
      (menor, actual) => (menor === null || actual.fecha < menor.fecha ? actual : menor),
      null,
    );
}

/**
 * Terminos estimados de una tutela. Se cuentan en dias habiles desde las fechas que publica la
 * fuente; el termino real corre desde la notificacion y no descuenta paros ni vacancia judicial.
 */
export function calcularTerminosTutela(datos: DatosTutela): ReadonlyArray<Termino> {
  const fallo = primera(datos.actuaciones, 'FALLO');
  const terminos: Termino[] = [];

  if (datos.fechaRadicacion) {
    const limite = sumarDiasHabiles(datos.fechaRadicacion, DIAS_FALLO_PRIMERA_INSTANCIA);
    const restantes = diasHabilesEntre(datos.hoy, limite);
    terminos.push({
      clave: 'FALLO_PRIMERA_INSTANCIA',
      descripcion: 'Plazo del juez para fallar en primera instancia (10 dias habiles)',
      fechaBase: datos.fechaRadicacion,
      fechaLimite: limite,
      diasHabilesRestantes: restantes,
      estado: estadoSegunPlazo(fallo !== null, restantes),
    });
  }

  if (fallo) {
    const limite = sumarDiasHabiles(fallo.fecha, DIAS_IMPUGNACION);
    const restantes = diasHabilesEntre(datos.hoy, limite);
    const impugnada = datos.actuaciones.some(
      (actuacion) => actuacion.categoria === 'IMPUGNACION' && actuacion.fecha >= fallo.fecha,
    );
    terminos.push({
      clave: 'IMPUGNACION',
      descripcion: 'Plazo para impugnar el fallo (3 dias habiles desde la notificacion)',
      fechaBase: fallo.fecha,
      fechaLimite: limite,
      diasHabilesRestantes: restantes,
      estado: estadoSegunPlazo(impugnada, restantes),
    });
  }

  return terminos;
}
