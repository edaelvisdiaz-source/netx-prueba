import { CredencialPortal } from '../boveda/boveda.service';
import { FuenteId } from '../tramites/tipos';

export interface EstadoPortal {
  /** Estado tal como lo muestra el portal, por ejemplo "En evaluacion academica". */
  readonly estado: string;
  /** Texto adicional que acompane al estado (observaciones, requerimientos). */
  readonly detalle: string | null;
}

export class PortalError extends Error {
  constructor(mensaje: string, readonly codigo: 'CREDENCIAL_INVALIDA' | 'NO_DISPONIBLE' | 'FORMATO') {
    super(mensaje);
    this.name = 'PortalError';
  }
}

/** Un portal que exige iniciar sesion con la cuenta del cliente para ver el estado de su tramite. */
export abstract class FuentePortal {
  abstract readonly id: FuenteId;
  abstract consultarEstado(credencial: CredencialPortal, radicado: string): Promise<EstadoPortal>;
}

/** Lista de portales disponibles en esta instalacion. */
export const PORTALES = Symbol('PORTALES');
