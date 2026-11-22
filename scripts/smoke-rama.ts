/**
 * Prueba en vivo contra la Rama Judicial: npm run smoke:rama -- <radicado de 23 digitos>
 * Sirve para confirmar, desde un equipo con salida a internet, que la fuente responde con el
 * formato que Radika espera.
 */
import { cargarEnv } from '../src/config/env';
import { RamaJudicialFuente } from '../src/fuentes/rama-judicial.fuente';
import { normalizarRadicadoJudicial } from '../src/tramites/radicado';

async function principal(): Promise<void> {
  const radicado = normalizarRadicadoJudicial(process.argv[2] ?? '');
  if (!radicado) throw new Error('Uso: npm run smoke:rama -- <radicado de 23 digitos>');
  const env = cargarEnv({
    DATABASE_URL: 'postgres://sin:uso@localhost:5432/sin_uso',
    RADIKA_API_KEYS: 'x'.repeat(32),
    ...process.env,
  });
  const fuente = new RamaJudicialFuente(env, fetch);
  const procesos = await fuente.buscarProcesos(radicado);
  console.log(`Procesos encontrados: ${procesos.length}`);
  for (const proceso of procesos) {
    const actuaciones = proceso.privado ? [] : await fuente.listarActuaciones(proceso.idFuente);
    console.log(`- ${proceso.despacho ?? 'sin despacho'} | radicado el ${proceso.fechaRadicacion ?? '?'} | ${actuaciones.length} actuaciones`);
    for (const actuacion of actuaciones.slice(0, 3)) console.log(`    ${actuacion.fecha} ${actuacion.titulo}`);
  }
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
