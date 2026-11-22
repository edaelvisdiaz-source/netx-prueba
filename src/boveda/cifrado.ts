import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const VERSION = 'v1';
const BYTES_IV = 12;
const BYTES_SELLO = 16;
export const BYTES_LLAVE = 32;

/** Cifra un texto. `contexto` ata el resultado a su dueno: no se puede descifrar con otro. */
export function cifrar(llave: Buffer, texto: string, contexto: string): string {
  const iv = randomBytes(BYTES_IV);
  const cifrador = createCipheriv(ALGORITMO, llave, iv, { authTagLength: BYTES_SELLO });
  cifrador.setAAD(Buffer.from(contexto, 'utf8'));
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return [VERSION, iv.toString('base64'), cifrador.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
}

/** Descifra lo que produjo `cifrar`. Lanza un error si el dato fue alterado o el contexto no coincide. */
export function descifrar(llave: Buffer, sobre: string, contexto: string): string {
  const [version, iv, sello, cifrado] = sobre.split(':');
  if (version !== VERSION || !iv || !sello || cifrado === undefined) throw new Error('Formato de dato cifrado desconocido');
  const bytesIv = Buffer.from(iv, 'base64');
  const bytesSello = Buffer.from(sello, 'base64');
  if (bytesIv.length !== BYTES_IV || bytesSello.length !== BYTES_SELLO) throw new Error('Formato de dato cifrado desconocido');
  const descifrador = createDecipheriv(ALGORITMO, llave, bytesIv, { authTagLength: BYTES_SELLO });
  descifrador.setAAD(Buffer.from(contexto, 'utf8'));
  descifrador.setAuthTag(bytesSello);
  return Buffer.concat([descifrador.update(Buffer.from(cifrado, 'base64')), descifrador.final()]).toString('utf8');
}
