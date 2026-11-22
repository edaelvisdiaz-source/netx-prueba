import { cargarEnv } from '../config/env';
import { ImapLectorBuzon, nombresDeAdjuntos } from './imap.lector-buzon';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/radika', RADIKA_API_KEYS: 'k'.repeat(32) };

describe('lector del buzon por IMAP', () => {
  test('queda apagado si falta algun dato de conexion', () => {
    expect(new ImapLectorBuzon(cargarEnv(base)).buzon).toBeNull();
    expect(new ImapLectorBuzon(cargarEnv({ ...base, IMAP_HOST: 'imap.ejemplo.com', IMAP_USER: 'a@ejemplo.com' })).buzon).toBeNull();
    const completo = cargarEnv({ ...base, IMAP_HOST: 'imap.ejemplo.com', IMAP_USER: 'a@ejemplo.com', IMAP_PASSWORD: 'secreto' });
    expect(new ImapLectorBuzon(completo).buzon).toBe('a@ejemplo.com');
    expect(completo.IMAP_PORT).toBe(993);
  });

  test('saca los nombres de los adjuntos y omite las imagenes de la firma', () => {
    const estructura = {
      childNodes: [
        { childNodes: [{ disposition: 'inline', parameters: { name: 'image.png' } }] },
        { disposition: 'attachment', dispositionParameters: { filename: '10. Fallo de tutela.pdf' } },
        { disposition: 'ATTACHMENT', parameters: { name: '02ActaReparto.pdf' } },
        { disposition: 'attachment' },
      ],
    };
    expect(nombresDeAdjuntos(estructura)).toEqual(['10. Fallo de tutela.pdf', '02ActaReparto.pdf']);
    expect(nombresDeAdjuntos(undefined)).toEqual([]);
  });
});
