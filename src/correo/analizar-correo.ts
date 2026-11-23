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

export type Autenticidad = 'VERIFICADO' | 'RECHAZADO' | 'SIN_DATOS';

function dominioDe(direccion: string): string {
  return direccion.toLowerCase().split('@').at(-1)?.replace(/[>"'\s]/g, '') ?? '';
}

/** Dos dominios se corresponden si son el mismo o uno es subdominio del otro. */
function alineados(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Dice si el servidor de correo que recibio el mensaje comprobo que de verdad viene del dominio
 * que aparece como remitente. El campo "De:" lo puede escribir cualquiera; lo que cuenta es el
 * veredicto (DMARC o firma DKIM del mismo dominio) que anota nuestro propio servidor.
 *
 * Solo se lee el primer encabezado Authentication-Results puesto por un servidor de confianza:
 * el receptor lo agrega arriba de todo, asi que uno falso incluido por el remitente queda debajo.
 */
export function autenticidadDelRemitente(
  encabezados: ReadonlyArray<string>,
  remitente: string,
  servidoresDeConfianza: ReadonlyArray<string>,
  dominiosConfiables: ReadonlyArray<string>,
): Autenticidad {
  const propio = encabezados.find((valor) => {
    const servidor = valor.split(';')[0].trim().toLowerCase().split(/\s/)[0];
    return servidoresDeConfianza.some((confiable) => servidor === confiable || servidor.endsWith(`.${confiable}`));
  });
  if (propio === undefined) return 'SIN_DATOS';
  const dominio = dominioDe(remitente);
  const delMismoDominio = (valor: string | undefined) =>
    valor !== undefined && alineados(dominioDe(valor), dominio) && esRemitenteConfiable(dominioDe(valor), dominiosConfiables);
  const aprobado = propio
    .split(';')
    .slice(1)
    .some((clausula) => {
      const sinComentarios = clausula.replace(/\([^)]*\)/g, ' ');
      const metodo = /^\s*(dmarc|dkim)\s*=\s*pass\b/i.exec(sinComentarios)?.[1].toLowerCase();
      if (!metodo) return false;
      const propiedad = metodo === 'dmarc' ? 'header.from' : 'header.d';
      return delMismoDominio(new RegExp(`${propiedad.replace('.', '\\.')}\\s*=\\s*([^\\s;]+)`, 'i').exec(sinComentarios)?.[1]);
    });
  return aprobado ? 'VERIFICADO' : 'RECHAZADO';
}

/** Valores de un encabezado dentro de un bloque de encabezados en bruto, con las lineas plegadas ya unidas. */
export function valoresDeEncabezado(bloque: string, nombre: string): string[] {
  const desplegado = bloque.replace(/\r?\n[ \t]+/g, ' ');
  const prefijo = `${nombre.toLowerCase()}:`;
  return desplegado
    .split(/\r?\n/)
    .filter((linea) => linea.toLowerCase().startsWith(prefijo))
    .map((linea) => linea.slice(prefijo.length).trim());
}
