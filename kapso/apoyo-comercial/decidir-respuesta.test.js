// Pruebas del envio de la respuesta. Se ejecutan con: node --test kapso/apoyo-comercial/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { handler } = new Function(`${readFileSync(join(__dirname, 'decidir-respuesta.js'), 'utf8')}; return { handler };`)();
const contexto = (respuesta) => ({ vars: { respuesta }, context: { phone_number: '573001234567' }, system: { whatsapp_config: { phone_number_id: '111' } } });
async function llamar(cuerpo, env = {}) {
  return (await handler(new Request('https://f.local', { method: 'POST', body: JSON.stringify(cuerpo) }), env)).json();
}

test('envia la respuesta de la IA por WhatsApp y nunca usa el paso de envio de Kapso', async (t) => {
  const llamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opciones) => { llamadas.push({ url, opciones }); return new Response('{}'); });
  const salida = await llamar({ available_edges: ['enviar', 'callar'], execution_context: contexto(' Hola ') }, { KAPSO_API_KEY: 'llave' });
  assert.deepEqual(salida, { next_edge: 'callar', vars: { envio: 'enviado' } });
  assert.match(llamadas[0].url, /\/111\/messages$/);
  const cuerpo = JSON.parse(llamadas[0].opciones.body);
  assert.equal(cuerpo.to, '573001234567');
  assert.equal(cuerpo.text.body, 'Hola');
  assert.equal(llamadas[0].opciones.headers['X-API-Key'], 'llave');
});

test('sin respuesta no envia nada', async (t) => {
  const espia = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const salida = await llamar({ available_edges: ['enviar', 'callar'], execution_context: contexto('') }, { KAPSO_API_KEY: 'llave' });
  assert.equal(salida.vars.envio, 'sin respuesta');
  assert.equal(espia.mock.callCount(), 0);
});

test('sin la llave lo deja anotado en vez de fallar', async (t) => {
  const espia = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const salida = await llamar({ available_edges: ['enviar', 'callar'], execution_context: contexto('Hola') });
  assert.equal(salida.vars.envio, 'falta el secreto KAPSO_API_KEY');
  assert.equal(espia.mock.callCount(), 0);
});

test('anota cuando WhatsApp rechaza el mensaje', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  const salida = await llamar({ available_edges: ['enviar', 'callar'], execution_context: contexto('Hola') }, { KAPSO_API_KEY: 'mala' });
  assert.equal(salida.vars.envio, 'rechazado por WhatsApp (401)');
});
