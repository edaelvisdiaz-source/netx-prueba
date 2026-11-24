// Pruebas de la pantalla. Se ejecutan con: node --test kapso/crm-demo/pantalla/pantalla.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { atender, claveCorrecta, crearSesion, sesionValida, tareaDeLectura } from './index.mjs';
import { leerDocumentos } from './lectura.mjs';

const sal = randomBytes(16);
const ENV = {
  USUARIO: 'demo',
  CLAVE_HASH: `${sal.toString('hex')}:${scryptSync('clave-buena', sal, 32).toString('hex')}`,
  SECRETO_SESION: 'secreto-de-prueba',
  KAPSO_URL: 'https://kapso.invalid/invoke',
  KAPSO_CLAVE: 'clave-kapso',
  DOCUMENTOS_BUCKET: 'deposito-demo',
  AWS_REGION: 'us-east-1',
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

const CODIGO = 'ab'.repeat(12);
function almacenDePrueba(tamanos = {}) {
  return {
    direccionParaSubir: async (ruta, tipo) => `https://deposito.invalid/${ruta}?tipo=${tipo}`,
    direccionParaVer: async (ruta) => `https://deposito.invalid/${ruta}?ver`,
    tamano: async (ruta) => (ruta in tamanos ? tamanos[ruta] : 1000),
  };
}
function sistemaDePrueba(t, respuestas) {
  const llamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    llamadas.push(cuerpo);
    return new Response(JSON.stringify(respuestas[cuerpo.accion] ?? { ok: false, error: 'sin respuesta' }), { headers: { 'Content-Type': 'application/json' } });
  });
  return llamadas;
}

test('el formulario se entrega en su enlace y puede subir al almacenamiento', async () => {
  const respuesta = await atender(evento(`/f/${CODIGO}`), ENV, AHORA);
  assert.equal(respuesta.statusCode, 200);
  assert.match(respuesta.headers['Content-Security-Policy'], /connect-src 'self' https:\/\/deposito-demo\.s3\.us-east-1\.amazonaws\.com/);
  assert.equal((await atender(evento('/f/no-es-un-codigo'), ENV, AHORA)).statusCode, 404);
});

test('el formulario no revela el identificador ni datos de la venta', async (t) => {
  sistemaDePrueba(t, { formulario_ver: { ok: true, id: 'venta-1', servicio: 'Apostilla', enviado: false } });
  const respuesta = await atender(evento('/api/formulario/ver', { codigo: CODIGO }), ENV, AHORA);
  assert.deepEqual(JSON.parse(respuesta.body), { ok: true, servicio: 'Apostilla', enviado: false });
});

test('solo autoriza subir documentos validos y a la carpeta de esa venta', async (t) => {
  sistemaDePrueba(t, { formulario_ver: { ok: true, id: 'venta-1', servicio: 'Apostilla', enviado: false } });
  const pedir = (datos) => atender(evento('/api/formulario/subir', { codigo: CODIGO, ...datos }), ENV, AHORA, almacenDePrueba());
  assert.equal((await pedir({ documento: 'otro', tipo: 'application/pdf', tamano: 10 })).statusCode, 400);
  assert.equal((await pedir({ documento: 'cedula', tipo: 'text/html', tamano: 10 })).statusCode, 400);
  assert.equal((await pedir({ documento: 'cedula', tipo: 'application/pdf', tamano: 16 * 1024 * 1024 })).statusCode, 400);
  const buena = JSON.parse((await pedir({ documento: 'cedula', tipo: 'application/pdf', tamano: 5000 })).body);
  assert.match(buena.ruta, /^ventas\/venta-1\/cedula-[0-9a-f]{16}\.pdf$/);
});

test('al enviar verifica que los tres archivos llegaron y son de esa venta', async (t) => {
  const llamadas = sistemaDePrueba(t, { formulario_ver: { ok: true, id: 'venta-1', servicio: 'Apostilla', enviado: false }, formulario_enviar: { ok: true, estado: 'Completo' } });
  const archivos = { cedula: 'ventas/venta-1/cedula-a.pdf', titulo: 'ventas/venta-1/titulo-a.pdf', notas: 'ventas/venta-1/notas-a.pdf' };
  const enviar = (misArchivos, almacen) => atender(evento('/api/formulario/enviar', { codigo: CODIGO, correo: 'a@b.co', acepta: true, archivos: misArchivos }), ENV, AHORA, almacen);
  const ajeno = JSON.parse((await enviar({ ...archivos, notas: 'ventas/venta-2/notas-a.pdf' }, almacenDePrueba())).body);
  assert.equal(ajeno.ok, false);
  const sinSubir = JSON.parse((await enviar(archivos, almacenDePrueba({ 'ventas/venta-1/titulo-a.pdf': null }))).body);
  assert.equal(sinSubir.ok, false);
  const pesado = JSON.parse((await enviar(archivos, almacenDePrueba({ 'ventas/venta-1/titulo-a.pdf': 20 * 1024 * 1024 }))).body);
  assert.equal(pesado.ok, false);
  assert.equal(llamadas.filter((llamada) => llamada.accion === 'formulario_enviar').length, 0);
  const tareas = [];
  const bien = JSON.parse((await atender(evento('/api/formulario/enviar', { codigo: CODIGO, correo: 'a@b.co', acepta: true, archivos }), ENV, AHORA, almacenDePrueba(), async (tarea) => { tareas.push(tarea); })).body);
  assert.deepEqual(bien, { ok: true });
  assert.deepEqual(tareas, [{ tarea: 'leer', id: 'venta-1' }]);
});

test('los documentos solo se pueden ver con sesion', async (t) => {
  sistemaDePrueba(t, { ver: { ok: true, venta: { registro: { archivos_formulario: { cedula: 'ventas/venta-1/cedula-a.pdf' } } } } });
  const sinSesion = await atender(evento('/api/documento', { id: 'venta-1', documento: 'cedula' }), ENV, AHORA, almacenDePrueba());
  assert.equal(sinSesion.statusCode, 401);
  const conSesion = JSON.parse((await atender(evento('/api/documento', { id: 'venta-1', documento: 'cedula' }, { cookie: sesion() }), ENV, AHORA, almacenDePrueba())).body);
  assert.match(conSesion.direccion, /cedula-a\.pdf\?ver$/);
  const inexistente = JSON.parse((await atender(evento('/api/documento', { id: 'venta-1', documento: 'notas' }, { cookie: sesion() }), ENV, AHORA, almacenDePrueba())).body);
  assert.equal(inexistente.ok, false);
});

const ARCHIVOS = { cedula: 'ventas/v/cedula-a.jpg', titulo: 'ventas/v/titulo-a.pdf', notas: 'ventas/v/notas-a.pdf' };
const respuestaDelModelo = (input) => ({ output: { message: { content: [{ toolUse: { name: 'registrar', input } }] } } });

test('la lectura envia cada documento al modelo y devuelve los datos con observaciones', async () => {
  const solicitudes = [];
  const datos = await leerDocumentos(ARCHIVOS, {
    leer: async () => Buffer.from('contenido'),
    conversar: async (solicitud) => { solicitudes.push(solicitud); return respuestaDelModelo({ nombre: 'Felipe Roldan', cedula: '1116156739', universidad: 'VIU', titulo: 'Master', diferencias: '', legibilidad: '',
      documentos: [{ documento: 'cedula', corresponde: true, legible: true }, { documento: 'notas', corresponde: false, legible: true }] }); },
  });
  const partes = solicitudes[0].messages[0].content;
  assert.equal(partes.filter((parte) => parte.document).length, 2);
  assert.equal(partes.filter((parte) => parte.image).length, 1);
  assert.equal(solicitudes[0].toolConfig.toolChoice.tool.name, 'registrar');
  assert.equal(datos.nombre, 'Felipe Roldan');
  assert.equal(datos.lectura.estado, 'hecha');
  assert.match(datos.lectura.observaciones, /Certificado academico de notas: no parece ser ese documento/);
});

test('los archivos muy pesados no se envian al modelo y quedan anotados', async () => {
  const pesado = Buffer.alloc(5 * 1024 * 1024);
  const todos = await leerDocumentos(ARCHIVOS, { leer: async () => pesado, conversar: async () => { throw new Error('no debe llamarse'); } });
  assert.equal(todos.lectura.estado, 'fallida');
  const uno = await leerDocumentos(ARCHIVOS, { leer: async (ruta) => (ruta.includes('titulo') ? pesado : Buffer.from('x')), conversar: async () => respuestaDelModelo({ nombre: 'A', documentos: [] }) });
  assert.match(uno.lectura.observaciones, /No se leyeron por su peso: Diploma/);
});

test('si el modelo falla, la venta queda marcada para revision manual', async (t) => {
  const llamadas = sistemaDePrueba(t, { ver: { ok: true, venta: { registro: { archivos_formulario: ARCHIVOS } } }, guardar_lectura: { ok: true } });
  t.mock.method(console, 'error', () => undefined);
  await tareaDeLectura('venta-1', ENV, { almacen: { leer: async () => Buffer.from('x') }, conversar: async () => { throw new Error('ThrottlingException'); } });
  const guardada = llamadas.find((llamada) => llamada.accion === 'guardar_lectura');
  assert.equal(guardada.lectura.estado, 'fallida');
  assert.equal(guardada.id, 'venta-1');
});

test('repetir la lectura exige sesion y lanza la tarea', async () => {
  const tareas = [];
  const lanzar = async (tarea) => { tareas.push(tarea); };
  assert.equal((await atender(evento('/api/leer', { id: 'venta-1' }), ENV, AHORA, almacenDePrueba(), lanzar)).statusCode, 401);
  const respuesta = await atender(evento('/api/leer', { id: 'venta-1' }, { cookie: sesion() }), ENV, AHORA, almacenDePrueba(), lanzar);
  assert.equal(respuesta.statusCode, 200);
  assert.deepEqual(tareas, [{ tarea: 'leer', id: 'venta-1' }]);
});

test('el codigo de las dos paginas es JavaScript valido', async () => {
  const { PAGINA } = await import('./pagina.mjs');
  const { FORMULARIO } = await import('./formulario.mjs');
  for (const pagina of [PAGINA, FORMULARIO]) {
    const codigo = pagina.split('<script nonce="__NONCE__">')[1].split('</script>')[0];
    assert.doesNotThrow(() => new Function(codigo));
  }
});
