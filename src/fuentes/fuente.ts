import { FechaISO } from '../terminos/dias-habiles';
import { FuenteId } from '../tramites/tipos';

export interface ProcesoFuente {
  readonly idFuente: string;
  readonly despacho: string | null;
  readonly sujetos: string | null;
  readonly fechaRadicacion: FechaISO | null;
  readonly privado: boolean;
}

export interface ActuacionFuente {
  readonly clave: string;
  readonly fecha: FechaISO;
  readonly titulo: string;
  readonly anotacion: string | null;
  readonly fechaInicioTermino: FechaISO | null;
  readonly fechaFinTermino: FechaISO | null;
  readonly fechaRegistro: FechaISO | null;
}

/** Un lugar donde se puede consultar el estado de un tramite. */
export abstract class Fuente {
  abstract readonly id: FuenteId;
  abstract buscarProcesos(radicado: string): Promise<ReadonlyArray<ProcesoFuente>>;
  abstract listarActuaciones(idFuente: string): Promise<ReadonlyArray<ActuacionFuente>>;
}

export class FuenteError extends Error {
  constructor(mensaje: string, readonly codigo: 'NO_DISPONIBLE' | 'RESPUESTA_INVALIDA') {
    super(mensaje);
    this.name = 'FuenteError';
  }
}
