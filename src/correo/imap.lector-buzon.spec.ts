import { cargarEnv } from '../config/env';
import { carpetasVigiladas, fechaSegura, ImapLectorBuzon, nombresDeAdjuntos, partesConRadicado, textoPlano } from './imap.lector-buzon';

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

  test('vigila todas las carpetas menos enviados, borradores, papelera y spam', () => {
    const carpetas = [
      { path: 'INBOX' }, { path: 'INBOX.Fallos' }, { path: 'INBOX.Admitidas tutelas' }, { path: 'INBOX.Sent', specialUse: '\\Sent' },
      { path: 'INBOX.Drafts', specialUse: '\\Drafts' }, { path: 'INBOX.Trash', specialUse: '\\Trash' }, { path: 'INBOX.spam' },
      { path: 'INBOX.Papelera' }, { path: 'Carpetas', flags: new Set(['\\Noselect']) },
    ];
    expect(carpetasVigiladas(carpetas, undefined)).toEqual(['INBOX', 'INBOX.Fallos', 'INBOX.Admitidas tutelas']);
    expect(carpetasVigiladas(carpetas, ['INBOX.Fallos', 'NO.EXISTE'])).toEqual(['INBOX.Fallos']);
    expect(cargarEnv({ ...base, IMAP_CARPETAS: ' INBOX , INBOX.Fallos ,' }).IMAP_CARPETAS).toEqual(['INBOX', 'INBOX.Fallos']);
    expect(cargarEnv({ ...base, IMAP_CARPETAS: '' }).IMAP_CARPETAS).toBeUndefined();
  });

  test('elige el cuerpo en texto y los PDF pequenos, primero el acta de reparto', () => {
    const estructura = {
      childNodes: [
        { childNodes: [{ part: '1.1', type: 'text/plain', size: 900 }, { part: '1.2', type: 'text/html', size: 4000 }] },
        { part: '2', type: 'image/png', disposition: 'inline', size: 270_117 },
        { part: '3', type: 'application/pdf', disposition: 'attachment', size: 174_000, dispositionParameters: { filename: '4450605.pdf' } },
        { part: '4', type: 'application/octet-stream', disposition: 'attachment', size: 240_000, dispositionParameters: { filename: 'ACTA 45229.PDF' } },
        { part: '5', type: 'application/pdf', disposition: 'attachment', size: 9_000_000, dispositionParameters: { filename: 'expediente.pdf' } },
        { part: '6', type: 'application/pdf', disposition: 'attachment', size: 100, dispositionParameters: { filename: 'otro.pdf' } },
        { part: '7', type: 'application/zip', disposition: 'attachment', size: 900_000, dispositionParameters: { filename: 'anexos.zip' } },
      ],
    };
    expect(partesConRadicado(estructura)).toEqual({ cuerpo: '1.1', pdfs: [{ part: '4', nombre: 'ACTA 45229.PDF' }, { part: '3', nombre: '4450605.pdf' }] });
    expect(partesConRadicado({ type: 'text/html', size: 10 })).toEqual({ cuerpo: '1', pdfs: [] });
    expect(partesConRadicado({ type: 'text/plain', size: 5_000_000 })).toEqual({ cuerpo: null, pdfs: [] });
    expect(partesConRadicado(undefined)).toEqual({ cuerpo: null, pdfs: [] });
  });

  test('saca el texto de un cuerpo HTML', () => {
    expect(textoPlano('<p>Radicado:&nbsp;<b>11001</b></p>\n<br/>fin')).toBe('Radicado: 11001 fin');
    expect(textoPlano('texto <sin cerrar')).toBe('texto');
  });

  test('un cuerpo hostil con miles de etiquetas sin cerrar se procesa al instante', () => {
    const inicio = Date.now();
    textoPlano('<'.repeat(200_000));
    textoPlano('<a '.repeat(70_000));
    expect(Date.now() - inicio).toBeLessThan(200);
  });

  test('una fecha ilegible no rompe la lectura', () => {
    expect(fechaSegura('2026-11-11T21:54:06Z')).toBe('2026-11-11T21:54:06.000Z');
    expect(Date.parse(fechaSegura('no es una fecha'))).toBeGreaterThan(Date.parse('2026-01-01'));
    expect(Date.parse(fechaSegura(new Date(Number.NaN)))).not.toBeNaN();
    expect(Date.parse(fechaSegura(undefined))).not.toBeNaN();
  });
});
