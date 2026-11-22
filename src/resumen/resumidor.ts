import { CategoriaActuacion, TipoTramite } from '../tramites/tipos';

export const URGENCIAS = ['ALTA', 'MEDIA', 'BAJA'] as const;

/** Explicacion de una actuacion en lenguaje sencillo, para la asesora y el cliente. */
export interface ResumenActuacion {
  readonly resumen: string;
  readonly queSignifica: string;
  readonly accionSugerida: string;
  readonly urgencia: (typeof URGENCIAS)[number];
}

export interface EntradaResumen {
  readonly tipoTramite: TipoTramite;
  readonly despacho: string | null;
  readonly fecha: string;
  readonly titulo: string;
  readonly anotacion: string | null;
  readonly categoria: CategoriaActuacion;
  /** Titulos de las actuaciones anteriores, de la mas reciente a la mas antigua. */
  readonly anteriores: ReadonlyArray<{ readonly fecha: string; readonly titulo: string }>;
}

/** Quien redacta el resumen. Devuelve `null` si no esta configurado o si no pudo hacerlo. */
export abstract class Resumidor {
  abstract resumir(entrada: EntradaResumen): Promise<ResumenActuacion | null>;
}
