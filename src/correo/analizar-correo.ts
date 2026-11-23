/** Pistas del radicado que suelen traer los correos de los juzgados, de la mas a la menos precisa. */
export interface PistasRadicado {
  /** Radicados de 23 digitos escritos completos. */
  readonly completos: ReadonlyArray<string>;
  /** Despacho (12 digitos) + ano + consecutivo: los primeros 21 digitos del radicado. */
  readonly prefijos: ReadonlyArray<string>;
  /** Solo ano + consecutivo (9 digitos): sirve si un unico tramite coincide. */
  readonly anoConsecutivo: ReadonlyArray<string>;
}

/** Entre los grupos del radicado los despachos escriben guion, punto, espacio o nada. */
const SEP = String.raw`(?:\s?[-.]\s?|\s{1,3})?`;
const GRUPOS_21 = [5, 2, 2, 3, 4, 5].map((largo) => String.raw`\d{${largo}}`).join(SEP);
const RADICADO_COMPLETO = new RegExp(String.raw`(?<!\d)${GRUPOS_21}${SEP}\d{2}(?!\d)`, 'g');
/** Los primeros 21 digitos, cuando el despacho omite el numero de instancia. */
const RADICADO_SIN_INSTANCIA = new RegExp(String.raw`(?<!\d)${GRUPOS_21}(?!\d)`, 'g');
/** Por ejemplo "110013109017-2026 - 9795". */
const DESPACHO_ANO_CONSECUTIVO = /(?<!\d)(\d{12})\s?-\s?(20\d{2})\s?-\s?(\d{1,5})(?!\d)/g;
/** Por ejemplo "TUTELA 2026-10254", "022-2026-00625-00" (juzgado abreviado) o "RAD 2026-00517-00" (SAMAI). */
const ANO_CONSECUTIVO = /(?<![\d-])(?:\d{3}\s?-\s?)?(20\d{2})\s?-\s?(\d{3,5})(?:\s?-\s?\d{2})?(?![\d-])/g;
const RAYAS = /[\u2010-\u2015\u2212]/g;
const PREFIJOS_RESPUESTA = /^\s*((RE|RV|FW|FWD|ENC|REENV)\s*:\s*)+/i;
const LARGO_CONSECUTIVO = 5;
const LARGO_MAXIMO_TITULO = 200;

function unicos(valores: ReadonlyArray<string>): string[] {
  return [...new Set(valores)];
}

export function extraerPistas(original: string): PistasRadicado {
  const texto = original.replace(RAYAS, '-');
  const soloDigitos = (hallazgo: RegExpMatchArray) => hallazgo[0].replace(/\D/g, '');
  const completos = unicos([...texto.matchAll(RADICADO_COMPLETO)].map(soloDigitos));
  const sinCompletos = texto.replace(RADICADO_COMPLETO, ' ');
  const prefijos = unicos([
    ...[...sinCompletos.matchAll(RADICADO_SIN_INSTANCIA)].map(soloDigitos),
    ...[...sinCompletos.matchAll(DESPACHO_ANO_CONSECUTIVO)].map(
      ([, despacho, ano, consecutivo]) => `${despacho}${ano}${consecutivo.padStart(LARGO_CONSECUTIVO, '0')}`,
    ),
  ]);
  const sinPrefijos = sinCompletos.replace(RADICADO_SIN_INSTANCIA, ' ').replace(DESPACHO_ANO_CONSECUTIVO, ' ');
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
