import { cargarEnv } from '../config/env';
import { FuenteError } from './fuente';
import { FuentesRegistry } from './fuentes.registry';
import { FetchFn, RamaJudicialFuente } from './rama-judicial.fuente';

const env = cargarEnv({
  DATABASE_URL: 'postgres://u:p@localhost:5432/radika',
  RADIKA_API_KEYS: 'k'.repeat(32),
  RAMA_BASE_URL: 'https://fuente.test/api/v2',
  RAMA_MIN_INTERVAL_MS: '0',
});

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

function fuenteCon(respuestas: Record<string, () => Response | Promise<Response>>) {
  const llamadas: string[] = [];
  const fetchFalso: FetchFn = async (entrada) => {
    const url = String(entrada);
    llamadas.push(url);
    const ruta = Object.keys(respuestas).find((clave) => url.includes(clave));
    if (!ruta) throw new TypeError('fetch failed');
    return respuestas[ruta]();
  };
  return { fuente: new RamaJudicialFuente(env, fetchFalso), llamadas };
}

const actuacion = (id: number, fecha: string) => ({
  idRegActuacion: id, fechaActuacion: `${fecha}T00:00:00`, actuacion: ' Auto admite ', anotacion: null,
  fechaInicial: null, fechaFinal: null, fechaRegistro: `${fecha}T00:00:00`,
});

describe('fuente Rama Judicial', () => {
  test('convierte los procesos y marca los privados', async () => {
    const { fuente, llamadas } = fuenteCon({
      NumeroRadicacion: () =>
        json({
          procesos: [
            { idProceso: 10, fechaProceso: '2026-11-03T00:00:00', despacho: ' JUZGADO 1 ', sujetosProcesales: 'A vs B', esPrivado: false },
            { idProceso: 11, fechaProceso: null, despacho: null, sujetosProcesales: null, esPrivado: true },
          ],
          paginacion: { cantidadPaginas: 1 },
        }),
    });
    const procesos = await fuente.buscarProcesos('11001310300120200012300');
    expect(procesos).toEqual([
      { idFuente: '10', despacho: 'JUZGADO 1', sujetos: 'A vs B', fechaRadicacion: '2026-11-03', privado: false },
      { idFuente: '11', despacho: null, sujetos: null, fechaRadicacion: null, privado: true },
    ]);
    expect(llamadas[0]).toContain('numero=11001310300120200012300');
  });

  test('un 404 significa que el proceso aun no aparece', async () => {
    const { fuente } = fuenteCon({ NumeroRadicacion: () => json({}, 404) });
    await expect(fuente.buscarProcesos('11001310300120200012300')).resolves.toEqual([]);
  });

  test('recorre todas las paginas de actuaciones', async () => {
    const { fuente, llamadas } = fuenteCon({
      'pagina=1': () => json({ actuaciones: [actuacion(1, '2026-11-04')], paginacion: { cantidadPaginas: 2 } }),
      'pagina=2': () => json({ actuaciones: [actuacion(2, '2026-11-05')], paginacion: { cantidadPaginas: 2 } }),
    });
    const actuaciones = await fuente.listarActuaciones('10');
    expect(actuaciones.map((item) => [item.clave, item.fecha, item.titulo])).toEqual([
      ['1', '2026-11-04', 'Auto admite'],
      ['2', '2026-11-05', 'Auto admite'],
    ]);
    expect(llamadas).toHaveLength(2);
  });

  test('error de red o 5xx se reporta como fuente no disponible', async () => {
    const caida = fuenteCon({});
    await expect(caida.fuente.buscarProcesos('1')).rejects.toMatchObject({ codigo: 'NO_DISPONIBLE' });
    const error500 = fuenteCon({ NumeroRadicacion: () => json({}, 503) });
    await expect(error500.fuente.buscarProcesos('1')).rejects.toBeInstanceOf(FuenteError);
  });

  test('un formato distinto se reporta como respuesta invalida', async () => {
    const otroFormato = fuenteCon({ NumeroRadicacion: () => json({ procesos: [{ id: 'x' }] }) });
    await expect(otroFormato.fuente.buscarProcesos('1')).rejects.toMatchObject({ codigo: 'RESPUESTA_INVALIDA' });
    const noJson = fuenteCon({ Actuaciones: () => new Response('<html>', { status: 200 }) });
    await expect(noJson.fuente.listarActuaciones('10')).rejects.toMatchObject({ codigo: 'RESPUESTA_INVALIDA' });
    const sinFecha = fuenteCon({
      Actuaciones: () => json({ actuaciones: [{ ...actuacion(1, '2026-11-04'), fechaActuacion: 'ayer' }] }),
    });
    await expect(sinFecha.fuente.listarActuaciones('10')).rejects.toMatchObject({ codigo: 'RESPUESTA_INVALIDA' });
  });

  test('no acepta identificadores que no sean numericos', async () => {
    const { fuente, llamadas } = fuenteCon({});
    await expect(fuente.listarActuaciones('10/../x')).rejects.toBeInstanceOf(FuenteError);
    expect(llamadas).toHaveLength(0);
  });

  test('el registro entrega la fuente o avisa que no existe', () => {
    const { fuente } = fuenteCon({});
    const registro = new FuentesRegistry(fuente);
    expect(registro.obtener('RAMA_JUDICIAL_CPNU')).toBe(fuente);
    expect(() => registro.obtener('MANUAL')).toThrow(/no tiene consulta automatica/);
  });
});
