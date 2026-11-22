import { calcularTerminosTutela } from './tutela';

describe('terminos de tutela', () => {
  test('sin fecha de radicacion no hay terminos', () => {
    expect(calcularTerminosTutela({ fechaRadicacion: null, actuaciones: [], hoy: '2026-11-20' })).toEqual([]);
  });

  test('plazo de fallo en curso, por vencer y vencido', () => {
    const base = { fechaRadicacion: '2026-11-03', actuaciones: [] };
    const enCurso = calcularTerminosTutela({ ...base, hoy: '2026-11-04' })[0];
    expect(enCurso.fechaLimite).toBe('2026-11-18');
    expect(enCurso.estado).toBe('EN_CURSO');
    expect(calcularTerminosTutela({ ...base, hoy: '2026-11-13' })[0].estado).toBe('POR_VENCER');
    const vencido = calcularTerminosTutela({ ...base, hoy: '2026-11-19' })[0];
    expect(vencido.estado).toBe('VENCIDO');
    expect(vencido.diasHabilesRestantes).toBe(-1);
  });

  test('el fallo cumple el primer termino y abre el de impugnacion', () => {
    const terminos = calcularTerminosTutela({
      fechaRadicacion: '2026-11-03',
      actuaciones: [
        { fecha: '2026-11-04', categoria: 'ADMISION' },
        { fecha: '2026-11-17', categoria: 'FALLO' },
      ],
      hoy: '2026-11-18',
    });
    expect(terminos.map((termino) => [termino.clave, termino.estado, termino.fechaLimite])).toEqual([
      ['FALLO_PRIMERA_INSTANCIA', 'CUMPLIDO', '2026-11-18'],
      ['IMPUGNACION', 'POR_VENCER', '2026-11-20'],
    ]);
  });

  test('la impugnacion registrada cumple el segundo termino', () => {
    const terminos = calcularTerminosTutela({
      fechaRadicacion: '2026-11-03',
      actuaciones: [
        { fecha: '2026-11-17', categoria: 'FALLO' },
        { fecha: '2026-11-19', categoria: 'IMPUGNACION' },
      ],
      hoy: '2026-11-30',
    });
    expect(terminos[1].estado).toBe('CUMPLIDO');
  });
});
