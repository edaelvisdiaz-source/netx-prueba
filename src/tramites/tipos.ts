export const TIPOS_TRAMITE = [
  'TUTELA', 'PROCESO_JUDICIAL', 'CONVALIDACION_MEN', 'LEGALIZACION_MEN', 'SAC_MEN', 'APOSTILLA',
] as const;
export type TipoTramite = (typeof TIPOS_TRAMITE)[number];

export const FUENTES = ['RAMA_JUDICIAL_CPNU', 'MANUAL', 'MEN_PORTAL'] as const;
export type FuenteId = (typeof FUENTES)[number];

export const ESTADOS_TRAMITE = ['ACTIVO', 'PAUSADO', 'CERRADO'] as const;
export type EstadoTramite = (typeof ESTADOS_TRAMITE)[number];

export const CATEGORIAS_ACTUACION = [
  'ADMISION', 'FALLO', 'IMPUGNACION', 'DESACATO', 'REQUERIMIENTO', 'REMISION_CORTE', 'OTRA',
] as const;
export type CategoriaActuacion = (typeof CATEGORIAS_ACTUACION)[number];

const TIPOS_JUDICIALES: ReadonlySet<TipoTramite> = new Set(['TUTELA', 'PROCESO_JUDICIAL']);

export function esTipoJudicial(tipo: TipoTramite): boolean {
  return TIPOS_JUDICIALES.has(tipo);
}

const TIPOS_MEN: ReadonlySet<TipoTramite> = new Set(['CONVALIDACION_MEN', 'LEGALIZACION_MEN', 'SAC_MEN']);

export function esTipoMen(tipo: TipoTramite): boolean {
  return TIPOS_MEN.has(tipo);
}

/** Fuente automatica disponible hoy para cada tipo. Los demas quedan en seguimiento manual. */
export function fuentePorDefecto(tipo: TipoTramite): FuenteId {
  return esTipoJudicial(tipo) ? 'RAMA_JUDICIAL_CPNU' : 'MANUAL';
}
