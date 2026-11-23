import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extraerPistas } from './analizar-correo';
import { textoDePdf } from './texto-pdf';

describe('texto de un PDF adjunto', () => {
  test('lee un acta de reparto y permite hallar el radicado', async () => {
    const texto = await textoDePdf(readFileSync(join(__dirname, '../../test/fixtures/acta-reparto.pdf')));
    expect(texto).toContain('ACTA INDIVIDUAL DE REPARTO');
    expect(extraerPistas(texto).completos).toEqual(['11001333704020260059300']);
  });

  test('un archivo que no es PDF da texto vacio en vez de fallar', async () => {
    expect(await textoDePdf(Buffer.from('esto no es un pdf'))).toBe('');
    expect(await textoDePdf(Buffer.alloc(0))).toBe('');
  });
});
