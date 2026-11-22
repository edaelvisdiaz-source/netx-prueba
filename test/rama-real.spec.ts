import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cargarEnv } from '../src/config/env';
import { RamaJudicialFuente } from '../src/fuentes/rama-judicial.fuente';
import { calcularTerminosTutela } from '../src/terminos/tutela';
import { clasificarActuacion } from '../src/tramites/clasificacion';

/** Respuestas reales de la Rama Judicial (nombre del accionante cambiado), tomadas el 2026-11-22. */
const leer = (archivo: string) => readFileSync(join(__dirname, 'fixtures', archivo), 'utf8');
const env = cargarEnv({
  DATABASE_URL: 'postgres://u:p@localhost:5432/radika',
  RADIKA_API_KEYS: 'k'.repeat(32),
  RAMA_MIN_INTERVAL_MS: '0',
});
const fuente = new RamaJudicialFuente(env, async (entrada) =>
  new Response(leer(String(entrada).includes('Actuaciones') ? 'rama-actuaciones.json' : 'rama-procesos.json')),
);

describe('formato real de la Rama Judicial', () => {
  test('lee el proceso', async () => {
    expect(await fuente.buscarProcesos('11001310305620260005200')).toEqual([
      {
        idFuente: '174331582',
        despacho: 'JUZGADO 056 CIVIL DEL CIRCUITO DE BOGOTÁ',
        sujetos: 'Demandante: ACCIONANTE DE EJEMPLO | Demandado: MINISTERIO DE EDUCACION NACIONAL',
        fechaRadicacion: '2026-01-30',
        privado: false,
      },
    ]);
  });

  test('lee, clasifica y calcula los terminos de una tutela real', async () => {
    const actuaciones = await fuente.listarActuaciones('174331582');
    const clasificadas = actuaciones.map((actuacion) => ({
      fecha: actuacion.fecha,
      categoria: clasificarActuacion(actuacion.titulo, actuacion.anotacion),
    }));
    expect(clasificadas).toEqual([
      { fecha: '2026-02-18', categoria: 'REMISION_CORTE' },
      { fecha: '2026-02-09', categoria: 'FALLO' },
      { fecha: '2026-02-09', categoria: 'OTRA' },
      { fecha: '2026-02-05', categoria: 'OTRA' },
      { fecha: '2026-01-30', categoria: 'ADMISION' },
      { fecha: '2026-01-30', categoria: 'OTRA' },
      { fecha: '2026-01-30', categoria: 'OTRA' },
    ]);
    const terminos = calcularTerminosTutela({ fechaRadicacion: '2026-01-30', actuaciones: clasificadas, hoy: '2026-02-10' });
    expect(terminos.map((termino) => [termino.clave, termino.fechaLimite, termino.estado])).toEqual([
      ['FALLO_PRIMERA_INSTANCIA', '2026-02-13', 'CUMPLIDO'],
      ['IMPUGNACION', '2026-02-12', 'POR_VENCER'],
    ]);
  });
});
