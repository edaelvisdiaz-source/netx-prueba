import { clasificarActuacion } from './clasificacion';
import { normalizarRadicadoJudicial, normalizarRadicadoLibre } from './radicado';
import { esTipoJudicial, fuentePorDefecto } from './tipos';

describe('radicado', () => {
  test('acepta 23 digitos con o sin separadores', () => {
    expect(normalizarRadicadoJudicial('11001-31-03-001-2020-00123-00')).toBe('11001310300120200012300');
    expect(normalizarRadicadoJudicial(' 11001310300120200012300 ')).toBe('11001310300120200012300');
  });

  test('rechaza radicados judiciales de otra longitud o con letras', () => {
    expect(normalizarRadicadoJudicial('1100131030012020001230')).toBeNull();
    expect(normalizarRadicadoJudicial('1100131030012020001230A')).toBeNull();
  });

  test('radicado libre limita longitud y caracteres', () => {
    expect(normalizarRadicadoLibre(' 2026-ER-123456 ')).toBe('2026-ER-123456');
    expect(normalizarRadicadoLibre('')).toBeNull();
    expect(normalizarRadicadoLibre('x'.repeat(65))).toBeNull();
    expect(normalizarRadicadoLibre('<script>')).toBeNull();
  });
});

describe('tipos', () => {
  test('solo los judiciales usan la Rama Judicial', () => {
    expect(esTipoJudicial('TUTELA')).toBe(true);
    expect(fuentePorDefecto('TUTELA')).toBe('RAMA_JUDICIAL_CPNU');
    expect(fuentePorDefecto('CONVALIDACION_MEN')).toBe('MANUAL');
  });
});

describe('clasificacion de actuaciones', () => {
  test.each([
    ['Auto admite tutela', null, 'ADMISION'],
    ['AUTO INADMITE', 'Concede 3 dias para subsanar', 'REQUERIMIENTO'],
    ['Sentencia de primera instancia', 'Tutela derechos', 'FALLO'],
    ['Auto concede impugnación', null, 'IMPUGNACION'],
    ['Abre incidente de desacato', null, 'DESACATO'],
    ['Fijacion estado', 'Actuación registrada', 'OTRA'],
    ['Remite Tutela Corte Constitucional', null, 'REMISION_CORTE'],
    ['AUTO ADMITE TUTELA', 'Se corre traslado; el fallo se proferira en 10 dias', 'ADMISION'],
    ['Constancia secretarial', 'Se recibe escrito de impugnacion', 'IMPUGNACION'],
    ['Constancia secretarial', 'Pasa al despacho para sentencia', 'OTRA'],
  ])('%s -> %s', (titulo, anotacion, esperado) => {
    expect(clasificarActuacion(titulo, anotacion)).toBe(esperado);
  });
});
