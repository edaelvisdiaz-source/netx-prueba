// Pruebas del envio de la respuesta. Se ejecutan con: node --test kapso/apoyo-comercial/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { handler } = new Function(`${readFileSync(join(__dirname, 'decidir-respuesta.js'), 'utf8')}; return { handler };`)();
const contexto = (respuesta, enviar_tarifa) => ({ vars: { respuesta, enviar_tarifa }, context: { phone_number: '573001234567' }, system: { whatsapp_config: { phone_number_id: '111' } } });
const almacen = (inicial = {}) => { const datos = new Map(Object.entries(inicial)); return { get: async (k) => datos.get(k) ?? null, put: async (k, v) => datos.set(k, v) }; };
async function llamar(cuerpo, entorno = {}) {
  const env = { KV: almacen(), ...entorno };
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

test('envia la imagen de tarifas antes del texto cuando la IA lo pide', async (t) => {
  const cuerpos = [];
  t.mock.method(globalThis, 'fetch', async (url, opciones) => { cuerpos.push(JSON.parse(opciones.body)); return new Response('{}'); });
  const KV = almacen();
  assert.deepEqual(await llamar({ accion: 'fijar_tarifa', media_id: '123456789' }, { KV }), { ok: true, tarifa: 'fijada' });
  const salida = await llamar({ available_edges: ['enviar', 'callar'], execution_context: contexto('Esta es la tarifa', 'si') }, { KAPSO_API_KEY: 'llave', KV });
  assert.equal(salida.vars.envio, 'enviado');
  assert.deepEqual(cuerpos.map((cuerpo) => cuerpo.type), ['image', 'text']);
  assert.equal(cuerpos[0].image.id, '123456789');
});

test('si no hay imagen configurada envia solo el texto y lo anota', async (t) => {
  const cuerpos = [];
  t.mock.method(globalThis, 'fetch', async (url, opciones) => { cuerpos.push(JSON.parse(opciones.body)); return new Response('{}'); });
  const salida = await llamar({ available_edges: ['enviar', 'callar'], execution_context: contexto('Tarifa', 'si') }, { KAPSO_API_KEY: 'llave' });
  assert.equal(cuerpos.length, 1);
  assert.match(salida.vars.envio, /sin imagen de tarifa/);
});
