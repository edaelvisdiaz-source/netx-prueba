import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derivar = promisify(scrypt) as (clave: string, sal: Buffer, largo: number) => Promise<Buffer>;
const BYTES_SAL = 16;
const BYTES_HUELLA = 64;
const VERSION = 's1';
export const LARGO_MINIMO_CLAVE = 10;
/** Sin 0/O ni 1/l/I, para que se pueda dictar sin confusiones. */
const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LARGO_TEMPORAL = 14;

export async function huellaDeClave(clave: string): Promise<string> {
  const sal = randomBytes(BYTES_SAL);
  const huella = await derivar(clave, sal, BYTES_HUELLA);
  return [VERSION, sal.toString('base64'), huella.toString('base64')].join(':');
}

export async function claveCoincide(clave: string, guardada: string): Promise<boolean> {
  const [version, sal, huella] = guardada.split(':');
  if (version !== VERSION || !sal || !huella) return false;
  const esperada = Buffer.from(huella, 'base64');
  const calculada = await derivar(clave, Buffer.from(sal, 'base64'), esperada.length || BYTES_HUELLA);
  return esperada.length === calculada.length && timingSafeEqual(esperada, calculada);
}

export function claveTemporal(): string {
  const bytes = randomBytes(LARGO_TEMPORAL * 2);
  let clave = '';
  for (let indice = 0; clave.length < LARGO_TEMPORAL && indice < bytes.length; indice += 1) {
    // Se descartan los valores que sesgarian la eleccion hacia las primeras letras.
    if (bytes[indice] < 256 - (256 % ALFABETO.length)) clave += ALFABETO[bytes[indice] % ALFABETO.length];
  }
  return clave.padEnd(LARGO_TEMPORAL, 'x');
}
