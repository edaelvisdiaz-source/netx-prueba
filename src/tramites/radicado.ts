const LONGITUD_RADICADO_JUDICIAL = 23;
const LONGITUD_MAXIMA_RADICADO = 64;

/** Quita espacios, guiones y puntos que la gente suele escribir en un radicado judicial. */
export function normalizarRadicadoJudicial(valor: string): string | null {
  const limpio = valor.replace(/[\s.\-]/g, '');
  return new RegExp(`^\\d{${LONGITUD_RADICADO_JUDICIAL}}$`).test(limpio) ? limpio : null;
}

export function normalizarRadicadoLibre(valor: string): string | null {
  const limpio = valor.trim();
  if (limpio.length === 0 || limpio.length > LONGITUD_MAXIMA_RADICADO) return null;
  return /^[\w\-./ ]+$/.test(limpio) ? limpio : null;
}
