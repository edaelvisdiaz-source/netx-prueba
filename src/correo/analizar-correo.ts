/** Pistas del radicado que suelen traer los correos de los juzgados, de la mas a la menos precisa. */
export interface PistasRadicado {
  /** Radicados de 23 digitos escritos completos. */
  readonly completos: ReadonlyArray<string>;
  /** Despacho (12 digitos) + ano + consecutivo: los primeros 21 digitos del radicado. */
  readonly prefijos: ReadonlyArray<string>;
  /** Solo ano + consecutivo (9 digitos): sirve si un unico tramite coincide. */
  readonly anoConsecutivo: ReadonlyArray<string>;
}

const RADICADO_COMPLETO = /(?<!\d)\d{5}[-\s]?\d{2}[-\s]?\d{2}[-\s]?\d{3}[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2}(?!\d)/g;
/** Por ejemplo "110013109017-2026 - 9795". */
const DESPACHO_ANO_CONSECUTIVO = /(?<!\d)(\d{12})\s?-\s?(20\d{2})\s?-\s?(\d{1,5})(?!\d)/g;
/** Por ejemplo "TUTELA 2026-10254" o "Rad. 2026-00123". */
const ANO_CONSECUTIVO = /(?<![\d-])(20\d{2})\s?-\s?(\d{3,5})(?![\d-])/g;
const PREFIJOS_RESPUESTA = /^\s*((RE|RV|FW|FWD|ENC|REENV)\s*:\s*)+/i;
const LARGO_CONSECUTIVO = 5;
const LARGO_MAXIMO_TITULO = 200;

function unicos(valores: ReadonlyArray<string>): string[] {
  return [...new Set(valores)];
}

export function extraerPistas(texto: string): PistasRadicado {
  const completos = unicos([...texto.matchAll(RADICADO_COMPLETO)].map((hallazgo) => hallazgo[0].replace(/[-\s]/g, '')));
  const sinCompletos = texto.replace(RADICADO_COMPLETO, ' ');
  const prefijos = unicos(
    [...sinCompletos.matchAll(DESPACHO_ANO_CONSECUTIVO)].map(
      ([, despacho, ano, consecutivo]) => `${despacho}${ano}${consecutivo.padStart(LARGO_CONSECUTIVO, '0')}`,
    ),
  );
  const sinPrefijos = sinCompletos.replace(DESPACHO_ANO_CONSECUTIVO, ' ');
  const anoConsecutivo = unicos(
    [...sinPrefijos.matchAll(ANO_CONSECUTIVO)].map(([, ano, consecutivo]) => `${ano}${consecutivo.padStart(LARGO_CONSECUTIVO, '0')}`),
  );
  return { completos, prefijos, anoConsecutivo };
}

/** Asunto sin los "RE:" / "RV:" del principio, listo para usarse como titulo de la actuacion. */
export function tituloDesdeAsunto(asunto: string): string {
  const limpio = asunto.replace(PREFIJOS_RESPUESTA, '').replace(/\s+/g, ' ').trim();
  return (limpio || 'Correo del despacho').slice(0, LARGO_MAXIMO_TITULO);
}

export function esRemitenteConfiable(direccion: string, dominios: ReadonlyArray<string>): boolean {
  const dominio = direccion.toLowerCase().split('@').at(-1) ?? '';
  return dominios.some((confiable) => dominio === confiable || dominio.endsWith(`.${confiable}`));
}
