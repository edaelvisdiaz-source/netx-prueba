import { nombreSeguro, tipoPorContenido } from './documentos.service';

describe('documentos', () => {
  test('reconoce el tipo por los primeros bytes, no por el nombre', () => {
    expect(tipoPorContenido(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(tipoPorContenido(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(tipoPorContenido(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(tipoPorContenido(Buffer.alloc(0))).toBeNull();
  });

  test('deja nombres sin rutas ni caracteres de control', () => {
    expect(nombreSeguro('C:\\Users\\ana\\Fallo.pdf')).toBe('Fallo.pdf');
    expect(nombreSeguro('../../etc/passwd')).toBe('passwd');
    expect(nombreSeguro('Fallo\r\nSet-Cookie: x.pdf')).toBe('FalloSet-Cookie: x.pdf');
    expect(nombreSeguro('  ')).toBe('documento');
    expect(nombreSeguro('a'.repeat(300))).toHaveLength(200);
  });
});
