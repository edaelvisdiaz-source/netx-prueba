import { randomBytes } from 'node:crypto';
import { cifrar, descifrar } from './cifrado';

const llave = randomBytes(32);

describe('cifrado de la boveda', () => {
  test('lo cifrado se recupera y nunca sale igual dos veces', () => {
    const uno = cifrar(llave, 'Clave$ecreta-ñ', 'tramite-1:clave');
    const dos = cifrar(llave, 'Clave$ecreta-ñ', 'tramite-1:clave');
    expect(uno).not.toBe(dos);
    expect(uno).not.toContain('Clave');
    expect(descifrar(llave, uno, 'tramite-1:clave')).toBe('Clave$ecreta-ñ');
  });

  test('no se descifra con otra llave, otro dueno o un dato alterado', () => {
    const sobre = cifrar(llave, 'secreto', 'tramite-1:clave');
    expect(() => descifrar(randomBytes(32), sobre, 'tramite-1:clave')).toThrow();
    expect(() => descifrar(llave, sobre, 'tramite-2:clave')).toThrow();
    const partes = sobre.split(':');
    const alterado = [...partes.slice(0, 3), Buffer.from('otro').toString('base64')].join(':');
    expect(() => descifrar(llave, alterado, 'tramite-1:clave')).toThrow();
    expect(() => descifrar(llave, 'v0:a:b:c', 'tramite-1:clave')).toThrow(/desconocido/);
    expect(() => descifrar(llave, 'basura', 'tramite-1:clave')).toThrow(/desconocido/);
  });
});
