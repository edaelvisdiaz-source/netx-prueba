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

const LARGO_SIN_INSTANCIA = 21;
/** Mas alla de la tercera instancia registrada no hay nada que buscar. */
const INSTANCIA_MAXIMA = 3;

/** Los dos ultimos digitos del radicado judicial numeran la instancia: 00 la primera, 01 la segunda... */
export function instanciaDe(radicado: string): number {
  return Number(radicado.slice(LARGO_SIN_INSTANCIA)) || 0;
}

/** El radicado sin el numero de instancia: identifica el proceso completo. */
export function procesoDe(radicado: string): string {
  return radicado.slice(0, LARGO_SIN_INSTANCIA);
}

export function radicadoDeInstancia(radicado: string, instancia: number): string {
  return `${procesoDe(radicado)}${String(instancia).padStart(2, '0')}`;
}

/**
 * Decide si vale la pena buscar la instancia `numero` de un proceso: siempre la primera, la
 * segunda y la que se registro; las siguientes, solo si la anterior existe.
 */
export function convieneBuscarInstancia(numero: number, registrada: number, anteriorExiste: boolean): boolean {
  if (numero > Math.max(INSTANCIA_MAXIMA, registrada)) return false;
  return numero <= Math.max(1, registrada) || anteriorExiste;
}
