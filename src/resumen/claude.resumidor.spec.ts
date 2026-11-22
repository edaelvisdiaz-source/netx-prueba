import Anthropic from '@anthropic-ai/sdk';
import { cargarEnv } from '../config/env';
import { ClaudeResumidor, ClienteAnthropic, crearClienteAnthropic } from './claude.resumidor';
import { EntradaResumen } from './resumidor';

const env = cargarEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/radika', RADIKA_API_KEYS: 'k'.repeat(32) });
const entrada: EntradaResumen = {
  tipoTramite: 'TUTELA', despacho: 'JUZGADO 056 CIVIL DEL CIRCUITO', fecha: '2026-02-09',
  titulo: 'Sentencia tutela primera Instancia', anotacion: null, categoria: 'FALLO',
  anteriores: Array.from({ length: 12 }, (_, indice) => ({ fecha: '2026-01-30', titulo: `Actuacion ${indice}` })),
};
const resumen = { resumen: 'El juez decidio la tutela.', queSignifica: 'Hay fallo.', accionSugerida: 'Revisar el fallo.', urgencia: 'ALTA' as const };

function clienteQue(responder: (parametros: Record<string, unknown>) => unknown): { cliente: ClienteAnthropic; llamadas: Array<Record<string, unknown>> } {
  const llamadas: Array<Record<string, unknown>> = [];
  const parse = async (parametros: Record<string, unknown>) => {
    llamadas.push(parametros);
    return responder(parametros);
  };
  return { cliente: { beta: { messages: { parse } } } as unknown as ClienteAnthropic, llamadas };
}

describe('resumen con Claude', () => {
  test('sin llave queda apagado', async () => {
    expect(crearClienteAnthropic(env)).toBeNull();
    expect(await new ClaudeResumidor(env, null).resumir(entrada)).toBeNull();
    expect(crearClienteAnthropic({ ...env, ANTHROPIC_API_KEY: 'sk-ant-prueba-000000000000' })).not.toBeNull();
  });

  test('envia la actuacion delimitada, el modelo configurado y devuelve el resumen', async () => {
    const { cliente, llamadas } = clienteQue(() => ({ stop_reason: 'end_turn', parsed_output: resumen }));
    expect(await new ClaudeResumidor(env, cliente).resumir(entrada)).toEqual(resumen);
    const [peticion] = llamadas;
    expect(peticion.model).toBe('claude-opus-5-5');
    expect(peticion.fallbacks).toBe('default');
    const contenido = (peticion.messages as Array<{ content: string }>)[0].content;
    expect(contenido).toContain('<actuacion>');
    expect(contenido).toContain('Sentencia tutela primera Instancia');
    expect(contenido).toContain('Actuacion 7');
    expect(contenido).not.toContain('Actuacion 8');
  });

  test('una negativa, un corte o una respuesta sin formato no producen resumen', async () => {
    for (const respuesta of [
      { stop_reason: 'refusal', parsed_output: null },
      { stop_reason: 'max_tokens', parsed_output: resumen },
      { stop_reason: 'end_turn', parsed_output: null },
    ]) {
      const { cliente } = clienteQue(() => respuesta);
      expect(await new ClaudeResumidor(env, cliente).resumir(entrada)).toBeNull();
    }
  });

  test('los errores de la API no se propagan', async () => {
    const errores = [
      new Anthropic.RateLimitError(429, undefined, 'limite', new Headers()),
      new Anthropic.APIError(500, undefined, 'caida', new Headers()),
      new Error('red'),
      'texto',
    ];
    for (const error of errores) {
      const { cliente } = clienteQue(() => {
        throw error;
      });
      expect(await new ClaudeResumidor(env, cliente).resumir({ ...entrada, anteriores: [], despacho: null, anotacion: 'RTA' })).toBeNull();
    }
  });
});
