import {
  diasHabilesEntre, domingoDePascua, esDiaHabil, festivosDeColombia, hoyEnColombia,
  soloFecha, sumarDiasHabiles,
} from './dias-habiles';

describe('dias habiles de Colombia', () => {
  test('calcula el domingo de Pascua', () => {
    expect(domingoDePascua(2026)).toBe('2026-04-05');
    expect(domingoDePascua(2027)).toBe('2027-03-28');
  });

  test('incluye festivos fijos, trasladados al lunes y los de Semana Santa', () => {
    const festivos = festivosDeColombia(2026);
    for (const fecha of [
      '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
      '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07',
      '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
    ]) {
      expect(festivos.has(fecha)).toBe(true);
    }
    expect(festivos.size).toBe(18);
    expect(festivos.has('2026-01-06')).toBe(false);
  });

  test('sabado, domingo y festivo no son habiles', () => {
    expect(esDiaHabil('2026-11-21')).toBe(false);
    expect(esDiaHabil('2026-11-22')).toBe(false);
    expect(esDiaHabil('2026-11-16')).toBe(false);
    expect(esDiaHabil('2026-11-17')).toBe(true);
  });

  test('suma dias habiles saltando Semana Santa', () => {
    expect(sumarDiasHabiles('2026-03-27', 10)).toBe('2026-04-14');
    expect(sumarDiasHabiles('2026-11-20', 1)).toBe('2026-11-23');
    expect(sumarDiasHabiles('2026-11-20', 0)).toBe('2026-11-20');
  });

  test('rechaza cantidades invalidas', () => {
    expect(() => sumarDiasHabiles('2026-01-01', -1)).toThrow(RangeError);
    expect(() => sumarDiasHabiles('2026-01-01', 1.5)).toThrow(RangeError);
  });

  test('cuenta dias habiles entre dos fechas en ambos sentidos', () => {
    expect(diasHabilesEntre('2026-03-27', '2026-04-14')).toBe(10);
    expect(diasHabilesEntre('2026-04-14', '2026-03-27')).toBe(-10);
    expect(diasHabilesEntre('2026-04-14', '2026-04-14')).toBe(0);
  });

  test('hoy en Colombia usa la zona horaria de Bogota', () => {
    expect(hoyEnColombia(new Date('2026-11-23T03:00:00Z'))).toBe('2026-11-22');
    expect(hoyEnColombia(new Date('2026-11-23T05:00:00Z'))).toBe('2026-11-23');
  });

  test('soloFecha extrae la fecha o devuelve null', () => {
    expect(soloFecha('2026-05-10T00:00:00')).toBe('2026-05-10');
    expect(soloFecha('no es fecha')).toBeNull();
    expect(soloFecha(null)).toBeNull();
    expect(soloFecha('')).toBeNull();
  });
});
