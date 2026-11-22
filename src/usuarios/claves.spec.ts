import { claveCoincide, claveTemporal, huellaDeClave } from './claves';

describe('claves de usuarios', () => {
  test('la huella no contiene la clave y solo coincide con la correcta', async () => {
    const huella = await huellaDeClave('Una-clave-larga-2026');
    expect(huella).toMatch(/^s1:/);
    expect(huella).not.toContain('clave');
    expect(await claveCoincide('Una-clave-larga-2026', huella)).toBe(true);
    expect(await claveCoincide('otra-clave-larga-2026', huella)).toBe(false);
    expect(await huellaDeClave('Una-clave-larga-2026')).not.toBe(huella);
  });

  test('una huella con formato desconocido nunca coincide', async () => {
    expect(await claveCoincide('x', 'texto')).toBe(false);
    expect(await claveCoincide('x', 's0:YQ==:YQ==')).toBe(false);
  });

  test('la clave temporal es larga, distinta cada vez y facil de dictar', () => {
    const claves = new Set(Array.from({ length: 50 }, claveTemporal));
    expect(claves.size).toBe(50);
    for (const clave of claves) expect(clave).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{14}$/);
  });
});
