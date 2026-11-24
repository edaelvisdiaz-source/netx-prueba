// Pruebas de la pantalla. Se ejecutan con: node --test kapso/crm-demo/pantalla/pantalla.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { atender, claveCorrecta, crearSesion, sesionValida } from './index.mjs';

const sal = randomBytes(16);
const ENV = {
  USUARIO: 'demo',
  CLAVE_HASH: `${sal.toString('hex')}:${scryptSync('clave-buena', sal, 32).toString('hex')}`,
  SECRETO_SESION: 'secreto-de-prueba',
  KAPSO_URL: 'https://kapso.invalid/invoke',
  KAPSO_CLAVE: 'clave-kapso',
};
const AHORA = 1_800_000_000_000;

function evento(ruta, cuerpo, { cookie, encabezados } = {}) {
  return {
    requestContext: { http: { method: cuerpo === undefined ? 'GET' : 'POST' } },
    rawPath: ruta,
    headers: encabezados || { 'content-type': 'application/json', 'x-demo': '1' },
    cookies: cookie ? [cookie] : [],
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  };
}
const sesion = () => `sesion_demo=${crearSesion(ENV.SECRETO_SESION, AHORA)}`;

test('la clave se compara contra su hash', () => {
  assert.equal(claveCorrecta('clave-buena', ENV.CLAVE_HASH), true);
  assert.equal(claveCorrecta('clave-mala', ENV.CLAVE_HASH), false);
  assert.equal(claveCorrecta('clave-buena', 'sin-formato'), false);
});

test('la sesion vence y no se puede falsificar', () => {
  const valor = crearSesion(ENV.SECRETO_SESION, AHORA);
  assert.equal(sesionValida(valor, ENV.SECRETO_SESION, AHORA + 1000), true);
  assert.equal(sesionValida(valor, ENV.SECRETO_SESION, AHORA + 13 * 3_600_000), false);
  assert.equal(sesionValida(`${AHORA + 9e9}.${'0'.repeat(64)}`, ENV.SECRETO_SESION, AHORA), false);
  assert.equal(sesionValida(valor, 'otro-secreto', AHORA), false);
});

test('la pagina se entrega con politica de seguridad y sin datos', async () => {
  const respuesta = await atender(evento('/'), ENV, AHORA);
  assert.equal(respuesta.statusCode, 200);
  assert.match(respuesta.headers['Content-Security-Policy'], /script-src 'nonce-/);
  assert.equal(respuesta.body.includes('__NONCE__'), false);
  assert.equal(respuesta.body.includes('clave-kapso'), false);
});

test('sin sesion no se puede ejecutar ninguna accion', async () => {
  const respuesta = await atender(evento('/api/accion', { accion: 'listar' }), ENV, AHORA);
  assert.equal(respuesta.statusCode, 401);
});

test('entrar con la clave correcta entrega una cookie segura', async () => {
  const mala = await atender(evento('/api/entrar', { usuario: 'demo', clave: 'no' }), ENV, AHORA);
  assert.equal(mala.statusCode, 401);
  const buena = await atender(evento('/api/entrar', { usuario: 'demo', clave: 'clave-buena' }), ENV, AHORA);
  assert.equal(buena.statusCode, 200);
  assert.match(buena.cookies[0], /HttpOnly; Secure; SameSite=Strict/);
});

test('rechaza solicitudes que no vienen de la propia pagina', async () => {
  const respuesta = await atender(evento('/api/accion', { accion: 'listar' }, { cookie: sesion(), encabezados: { 'content-type': 'text/plain' } }), ENV, AHORA);
  assert.equal(respuesta.statusCode, 400);
});

test('solo reenvia acciones permitidas y pone la clave del sistema', async (t) => {
  const llamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opciones) => {
    llamadas.push({ url, opciones });
    return new Response(JSON.stringify({ ok: true, ventas: [] }), { headers: { 'Content-Type': 'application/json' } });
  });
  const prohibida = await atender(evento('/api/accion', { accion: 'guardar_pago' }, { cookie: sesion() }), ENV, AHORA);
  assert.equal(prohibida.statusCode, 400);
  const herramienta = await atender(evento('/api/accion', { input: { accion: 'consultar_venta' } }, { cookie: sesion() }), ENV, AHORA);
  assert.equal(herramienta.statusCode, 400);
  const permitida = await atender(evento('/api/accion', { accion: 'listar' }, { cookie: sesion() }), ENV, AHORA);
  assert.equal(permitida.statusCode, 200);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].opciones.headers['X-Demo-Token'], 'clave-kapso');
});

test('si el sistema falla responde un error claro sin detalles internos', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('ECONNRESET interno'); });
  t.mock.method(console, 'error', () => undefined);
  const respuesta = await atender(evento('/api/accion', { accion: 'listar' }, { cookie: sesion() }), ENV, AHORA);
  assert.equal(respuesta.statusCode, 502);
  assert.equal(respuesta.body.includes('ECONNRESET'), false);
});

test('bloquea tras varios intentos fallidos', async () => {
  let ultima;
  for (let i = 0; i < 6; i += 1) ultima = await atender(evento('/api/entrar', { usuario: 'demo', clave: 'x' }), ENV, AHORA + 100_000);
  assert.equal(ultima.statusCode, 429);
  const despues = await atender(evento('/api/entrar', { usuario: 'demo', clave: 'clave-buena' }), ENV, AHORA + 100_000 + 16 * 60_000);
  assert.equal(despues.statusCode, 200);
});
