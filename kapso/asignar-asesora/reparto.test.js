// Pruebas del reparto. Se ejecutan con: node --test kapso/asignar-asesora/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// La funcion se despliega tal cual en Kapso (sin export), asi que aqui se carga como texto.
const codigo = readFileSync(join(__dirname, 'index.js'), 'utf8');
const { handler, elegirAsesora, momentoLocal, estaAbierto, buscarMiembro, CONFIG } = new Function(`${codigo}; return { handler, elegirAsesora, momentoLocal, estaAbierto, buscarMiembro, CONFIG };`)();

const E = 'Estefania Diaz', M = 'Melissa Orellano', A = 'Andrea Martinez';
const lunes10 = { dia: 1, hora: '10:00' };
const sabado10 = { dia: 6, hora: '10:00' };

test('reparte por turnos entre las titulares de lunes a viernes', () => {
  const primera = elegirAsesora(CONFIG, lunes10, { turno: 0, ausentes: [], duena: null });
  assert.equal(primera.asesora, E);
  const segunda = elegirAsesora(CONFIG, lunes10, { turno: primera.turno, ausentes: [], duena: null });
  assert.equal(segunda.asesora, M);
  assert.equal(elegirAsesora(CONFIG, lunes10, { turno: segunda.turno, ausentes: [], duena: null }).asesora, E);
});

test('el cliente que ya fue atendido vuelve con su asesora y no gasta turno', () => {
  const decision = elegirAsesora(CONFIG, lunes10, { turno: 0, ausentes: [], duena: M });
  assert.equal(decision.asesora, M);
  assert.equal(decision.turno, 0);
});

test('si su asesora esta ausente lo atiende el reemplazo, sin cambiarle la asesora', () => {
  const decision = elegirAsesora(CONFIG, lunes10, { turno: 0, ausentes: ['melissa orellano'], duena: M });
  assert.equal(decision.asesora, A);
  assert.equal(decision.duena, M);
});

test('un cliente nuevo salta a la titular ausente y el turno sigue ordenado', () => {
  const decision = elegirAsesora(CONFIG, lunes10, { turno: 0, ausentes: [E], duena: null });
  assert.equal(decision.asesora, M);
  assert.equal(decision.turno, 0);
});

test('los sabados atiende el reemplazo; si falta, vuelve a las titulares', () => {
  assert.equal(elegirAsesora(CONFIG, sabado10, { turno: 0, ausentes: [], duena: E }).asesora, A);
  assert.equal(elegirAsesora(CONFIG, sabado10, { turno: 0, ausentes: [A], duena: E }).asesora, E);
  assert.equal(elegirAsesora(CONFIG, sabado10, { turno: 1, ausentes: [A], duena: null }).asesora, M);
});

test('sin titulares va al reemplazo; sin nadie queda sin asignar', () => {
  assert.equal(elegirAsesora(CONFIG, lunes10, { turno: 0, ausentes: [E, M], duena: null }).asesora, A);
  const nadie = elegirAsesora(CONFIG, lunes10, { turno: 0, ausentes: [E, M, A], duena: null });
  assert.equal(nadie.asesora, null);
});

test('horario en hora de Bogota, sin importar el reloj del servidor', () => {
  // 2026-11-23 es lunes. 15:00 UTC = 10:00 en Bogota; 23:30 UTC = 18:30 (cerrado); 04:00 UTC del martes = lunes 23:00.
  assert.deepEqual(momentoLocal(new Date('2026-11-23T15:00:00Z'), 'America/Bogota'), { dia: 1, hora: '10:00' });
  assert.equal(estaAbierto(momentoLocal(new Date('2026-11-23T15:00:00Z'), 'America/Bogota'), CONFIG.horario), true);
  assert.equal(estaAbierto(momentoLocal(new Date('2026-11-23T23:30:00Z'), 'America/Bogota'), CONFIG.horario), false);
  assert.deepEqual(momentoLocal(new Date('2026-11-24T04:00:00Z'), 'America/Bogota'), { dia: 1, hora: '23:00' });
  assert.deepEqual(momentoLocal(new Date('2026-11-23T05:00:00Z'), 'America/Bogota'), { dia: 1, hora: '00:00' });
  assert.equal(estaAbierto({ dia: 7, hora: '10:00' }, CONFIG.horario), false);
  assert.equal(estaAbierto({ dia: 6, hora: '13:00' }, CONFIG.horario), false);
});

test('encuentra a la asesora aunque el nombre tenga tildes u otra forma', () => {
  const lista = [{ id: '1', nombre: 'Estefanía Díaz' }, { id: '2', nombre: 'MELISSA ORELLANO' }, { id: '3', nombre: 'Andrea M.' }];
  assert.equal(buscarMiembro(lista, E).id, '1');
  assert.equal(buscarMiembro(lista, M).id, '2');
  assert.equal(buscarMiembro(lista, A).id, '3');
  assert.equal(buscarMiembro(lista, 'Laura Rhenals'), null);
});

// ---- La funcion completa, con Kapso simulado ----
function entorno({ usuarios, asignaciones = [], llave = 'k' } = {}) {
  const almacen = new Map();
  const llamadas = [];
  const KV = {
    get: async (clave, opciones) => { const valor = almacen.get(clave); return valor === undefined ? null : opciones && opciones.type === 'json' ? JSON.parse(valor) : valor; },
    put: async (clave, valor) => { almacen.set(clave, valor); },
  };
  globalThis.fetch = async (url, opciones) => {
    llamadas.push({ metodo: opciones.method, url: String(url), cuerpo: opciones.body ? JSON.parse(opciones.body) : null, llave: opciones.headers['X-API-Key'] });
    const cuerpo = String(url).endsWith('/users') ? { data: usuarios } : String(url).endsWith('/assignments') && opciones.method === 'GET' ? { data: asignaciones } : { ok: true };
    return new Response(JSON.stringify(cuerpo), { status: 200 });
  };
  return { env: { KV, ...(llave ? { KAPSO_API_KEY: llave } : {}) }, almacen, llamadas };
}
const pedir = (env, cuerpo) => handler(new Request('https://x/', { method: 'POST', body: JSON.stringify(cuerpo) }), env).then((respuesta) => respuesta.json());
const usuarios = [{ id: 'm-e', user_id: 'u-e', name: 'Estefanía Díaz' }, { id: 'm-m', user_id: 'u-m', name: 'Melissa Orellano' }, { id: 'm-a', user_id: 'u-a', name: 'Andrea Martínez' }];
const evento = (id, telefono) => ({ ahora: '2026-11-23T15:00:00Z', execution_context: { system: { event: { conversation: { id, phone_number: telefono, phone_number_id: 'linea-1' } } } } });

test('asigna en Kapso, recuerda a la asesora del cliente y avanza el turno', async () => {
  const { env, almacen, llamadas } = entorno({ usuarios });
  const uno = await pedir(env, evento('c1', '+57 300 111'));
  assert.equal(uno.vars.reparto_asesora, 'Estefanía Díaz');
  const asignacion = llamadas.find((llamada) => llamada.metodo === 'POST');
  assert.equal(asignacion.url, 'https://api.kapso.ai/platform/v1/whatsapp/conversations/c1/assignments');
  assert.equal(asignacion.cuerpo.assignment.user_id, 'u-e');
  assert.equal(asignacion.llave, 'k');
  assert.equal(almacen.get('reparto:contacto:57300111'), E);

  assert.equal((await pedir(env, evento('c2', '57300222'))).vars.reparto_asesora, 'Melissa Orellano');
  // El primer cliente vuelve otro dia: le toca de nuevo Estefania aunque el turno vaya en otra.
  assert.equal((await pedir(env, evento('c3', '57300111'))).vars.reparto_asesora, 'Estefanía Díaz');
  assert.equal((await pedir(env, evento('c4', '57300333'))).vars.reparto_asesora, 'Estefanía Díaz');
  assert.equal(llamadas.filter((llamada) => llamada.url.endsWith('/users')).length, 1);
});

test('fuera de horario asigna y avisa al cliente una vez', async () => {
  const { env, llamadas } = entorno({ usuarios });
  const respuesta = await pedir(env, { ...evento('c9', '57300999'), ahora: '2026-11-24T02:00:00Z' });
  assert.equal(respuesta.vars.reparto_fuera_de_horario, true);
  assert.equal(respuesta.vars.reparto_aviso_enviado, true);
  const aviso = llamadas.find((llamada) => llamada.url.includes('/meta/whatsapp/'));
  assert.equal(aviso.url, 'https://api.kapso.ai/meta/whatsapp/v24.0/linea-1/messages');
  assert.equal(aviso.cuerpo.to, '57300999');
  assert.match(aviso.cuerpo.text.body, /fuera de nuestro horario/);
});

test('no pisa una asignacion hecha a mano ni asigna a quien no esta en Kapso', async () => {
  const yaAsignada = entorno({ usuarios, asignaciones: [{ id: 'a1', user_id: 'u-m', active: true }] });
  const respuesta = await pedir(yaAsignada.env, evento('c1', '57300111'));
  assert.equal(respuesta.vars.reparto_asesora, '');
  assert.equal(yaAsignada.llamadas.some((llamada) => llamada.metodo === 'POST'), false);
  assert.equal(yaAsignada.almacen.has('reparto:turno'), false);

  const sinInvitar = entorno({ usuarios: [{ id: 'u-x', name: 'Elvis Díaz' }] });
  const pendiente = await pedir(sinInvitar.env, evento('c1', '57300111'));
  assert.match(pendiente.vars.reparto_motivo, /aún no es miembro/);
  assert.equal(sinInvitar.llamadas.some((llamada) => llamada.metodo === 'POST'), false);
});

test('ausencias, ensayo y falta de llave', async () => {
  const { env, llamadas } = entorno({ usuarios });
  assert.deepEqual((await pedir(env, { accion: 'ausencia', asesora: 'melissa', ausente: true })).ausentes, [M]);
  assert.equal((await pedir(env, { accion: 'ausencia', asesora: 'nadie', ausente: true })).ok, false);
  const ensayo = await pedir(env, { accion: 'simular', ahora: '2026-11-23T15:00:00Z', contacto: '57300444' });
  assert.equal(ensayo.ensayo, true);
  assert.equal(ensayo.decision.asesora, E);
  assert.equal(llamadas.length, 0);
  assert.deepEqual((await pedir(env, { accion: 'ausencia', asesora: 'Melissa Orellano', ausente: false })).ausentes, []);

  const sinLlave = entorno({ usuarios, llave: null });
  assert.equal((await pedir(sinLlave.env, evento('c1', '57300111'))).error, 'Falta el secreto KAPSO_API_KEY');
  assert.equal((await pedir(sinLlave.env, {})).error, 'No llegó la conversación');
});
