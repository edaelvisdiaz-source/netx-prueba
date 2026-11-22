export const TIPOS_TRAMITE = [
  'TUTELA', 'PROCESO_JUDICIAL', 'CONVALIDACION_MEN', 'LEGALIZACION_MEN', 'SAC_MEN', 'APOSTILLA',
] as const;
export type TipoTramite = (typeof TIPOS_TRAMITE)[number];

export const FUENTES = ['RAMA_JUDICIAL_CPNU', 'MANUAL', 'MEN_CONVALIDACION', 'MEN_LEGALIZACION'] as const;
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

/**
 * El Ministerio lleva dos procesos distintos, cada uno en su propia plataforma: el estado de la
 * solicitud de convalidacion y el proceso de legalizacion. Ninguno avisa por correo.
 */
const PORTAL_POR_TIPO: Readonly<Partial<Record<TipoTramite, FuenteId>>> = {
  CONVALIDACION_MEN: 'MEN_CONVALIDACION',
  LEGALIZACION_MEN: 'MEN_LEGALIZACION',
};

/** Portal con usuario y clave que corresponde a un tipo de tramite, si lo tiene. */
export function portalDe(tipo: TipoTramite): FuenteId | null {
  return PORTAL_POR_TIPO[tipo] ?? null;
}

export function esFuentePortal(fuente: FuenteId): boolean {
  return Object.values(PORTAL_POR_TIPO).includes(fuente);
}

/** Fuente automatica disponible hoy para cada tipo. Los demas quedan en seguimiento manual. */
export function fuentePorDefecto(tipo: TipoTramite): FuenteId {
  return esTipoJudicial(tipo) ? 'RAMA_JUDICIAL_CPNU' : 'MANUAL';
}
