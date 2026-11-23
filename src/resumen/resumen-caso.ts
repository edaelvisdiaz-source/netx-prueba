export const SENTIDOS_FALLO = ['A_FAVOR', 'EN_CONTRA', 'PARCIAL', 'CARENCIA_DE_OBJETO', 'SIN_FALLO', 'NO_SE_PUEDE_SABER'] as const;
export type SentidoFallo = (typeof SENTIDOS_FALLO)[number];

/** Lo que redacta la IA sobre el caso completo. */
export interface TextoResumenCaso {
  readonly resumen: string;
  readonly estadoActual: string;
  readonly sentidoFallo: SentidoFallo;
  readonly plazos: ReadonlyArray<string>;
  readonly pendientes: ReadonlyArray<string>;
  readonly advertencias: ReadonlyArray<string>;
}

/** El resumen tal como queda guardado en el tramite, con lo que se uso para redactarlo. */
export interface ResumenCaso extends TextoResumenCaso {
  readonly generadoAt: string;
  readonly actuaciones: number;
  readonly documentosLeidos: ReadonlyArray<{ readonly id: string; readonly nombre: string }>;
  /** Documentos del tramite que no se enviaron por tamano o cantidad. */
  readonly documentosOmitidos: number;
}

export interface DocumentoParaResumen {
  readonly nombre: string;
  readonly tipo: string;
  readonly contenido: Buffer;
}

export interface EntradaResumenCaso {
  readonly tipoTramite: string;
  readonly despacho: string | null;
  readonly partes: string | null;
  readonly fechaRadicacion: string | null;
  /** Etapa y nota que Radika calculo con las actuaciones. */
  readonly etapa: string | null;
  readonly hoy: string;
  readonly actuaciones: ReadonlyArray<{ readonly fecha: string; readonly titulo: string; readonly anotacion: string | null }>;
  readonly documentos: ReadonlyArray<DocumentoParaResumen>;
}

/** Quien redacta el resumen del caso. */
export abstract class ResumidorDeCasos {
  /** `false` si no hay llave de IA configurada. */
  abstract readonly activo: boolean;
  /** Devuelve `null` si no pudo redactarlo. */
  abstract resumir(entrada: EntradaResumenCaso): Promise<TextoResumenCaso | null>;
}
