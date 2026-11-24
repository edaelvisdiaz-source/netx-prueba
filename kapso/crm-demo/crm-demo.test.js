// Pruebas del sistema de demostracion. Se ejecutan con: node --test kapso/crm-demo/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// La funcion se despliega tal cual en Kapso (sin export), asi que aqui se carga como texto.
const codigo = readFileSync(join(__dirname, 'index.js'), 'utf8');
const { handler, leerValor, compararPago, mismoTelefono, estadoDelRegistro, elegirAsesora } = new Function(
  `${codigo}; return { handler, leerValor, compararPago, mismoTelefono, estadoDelRegistro, elegirAsesora };`,
)();

/** Base de datos y almacen en memoria con la misma forma que usa la funcion. */
function entornoDePrueba(secretos = {}) {
  const filas = new Map();
  const columnas = ['id', 'creada', 'actualizada', 'cliente', 'telefono', 'servicio', 'valor', 'asesora', 'estado_pago', 'estado_registro', 'pago', 'registro', 'historial'];
  const sentencia = (sql, valores = []) => ({
    bind: (...nuevos) => sentencia(sql, nuevos),
    run: async () => {
      if (sql.startsWith('INSERT')) filas.set(valores[0], Object.fromEntries(columnas.map((columna, i) => [columna, valores[i]])));
      if (sql.startsWith('UPDATE')) {
        const [actualizada, cliente, estado_pago, estado_registro, pago, registro, historial, etapa_manual, id] = valores;
        filas.set(id, { ...filas.get(id), actualizada, cliente, estado_pago, estado_registro, pago, registro, historial, etapa_manual });
      }
      if (sql.startsWith('ALTER')) throw new Error('duplicate column name');
      if (sql.startsWith('DELETE')) filas.delete(valores[0]);
    },
    all: async () => ({ results: [...filas.values()].sort((a, b) => b.creada.localeCompare(a.creada)) }),
    first: async () => filas.get(valores[0]) || null,
  });
  const kv = new Map();
  return { DB: { prepare: (sql) => sentencia(sql.trim()) }, KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) }, ...secretos };
}

async function llamar(env, cuerpo, encabezados = {}) {
  const respuesta = await handler(new Request('https://demo.local', { method: 'POST', headers: encabezados, body: JSON.stringify(cuerpo) }), env);
  return { estado: respuesta.status, ...(await respuesta.json()) };
}

const desdeElChat = (telefono, input) => ({ input, execution_context: { context: { phone_number: telefono } } });
const VENTA = { accion: 'crear_venta', telefono: '+57 300 123 4567', servicio: 'Apostilla de titulo', valor: '1.250.000' };

test('lee valores en los formatos usuales de un comprobante', () => {
  assert.equal(leerValor('$ 1.250.000'), 1250000);
  assert.equal(leerValor('1,250,000.00'), 1250000);
  assert.equal(leerValor('1.250.000,50'), 1250000);
  assert.equal(leerValor('350.000'), 350000);
  assert.equal(leerValor('COP 85000'), 85000);
  assert.equal(leerValor(420000), 420000);
  assert.equal(leerValor('no se lee'), null);
});

test('compara el pago con el valor de la venta', () => {
  assert.deepEqual(compararPago(1250000, 1250000), { resultado: 'coincide', diferencia: 0 });
  assert.deepEqual(compararPago(1250000, 1000000), { resultado: 'pago menor', diferencia: -250000 });
  assert.deepEqual(compararPago(1250000, 1300000), { resultado: 'pago mayor', diferencia: 50000 });
  assert.equal(compararPago(1250000, null).resultado, 'valor no legible');
});

test('reconoce el mismo telefono con o sin indicativo', () => {
  assert.equal(mismoTelefono('573001234567', '300 123 4567'), true);
  assert.equal(mismoTelefono('573001234567', '573001234568'), false);
  assert.equal(mismoTelefono('', ''), false);
});

test('el registro queda completo solo con titulo, notas, cedula y correo', () => {
  assert.equal(estadoDelRegistro(['titulo', 'notas', 'cedula'], 'a@b.co').estado, 'Completo');
  assert.deepEqual(estadoDelRegistro(['titulo', 'Cedula'], 'a@b.co').faltantes, ['notas']);
  assert.deepEqual(estadoDelRegistro(['titulo', 'notas', 'cedula'], '').faltantes, ['correo']);
});

test('reparte las ventas por turnos y el sabado van al reemplazo', () => {
  assert.deepEqual(elegirAsesora('Mon', 0), { asesora: 'Estefania Diaz', turno: 1 });
  assert.deepEqual(elegirAsesora('Tue', 1), { asesora: 'Melissa Orellano', turno: 2 });
  assert.deepEqual(elegirAsesora('Sat', 2), { asesora: 'Andrea Martinez', turno: 2 });
});

test('recorre el flujo completo: venta, pago, registro y confirmacion de Contabilidad', async () => {
  const env = entornoDePrueba();
  const { venta } = await llamar(env, VENTA);
  assert.equal(venta.valor, 1250000);
  assert.equal(venta.estado_pago, 'Sin soporte');

  const consulta = await llamar(env, desdeElChat('573001234567', { accion: 'consultar_venta' }));
  assert.equal(consulta.encontrada, true);
  assert.equal(consulta.valor_esperado, 1250000);

  const pago = await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '$1.250.000', referencia: 'M123', medio: 'Nequi' }));
  assert.equal(pago.comparacion, 'coincide');

  const registro = await llamar(env, desdeElChat('573001234567', {
    accion: 'guardar_registro', nombre: 'David Andres Lasso Garcia', cedula: '1.088.357.834', correo: 'David@Correo.com',
    documentos_recibidos: ['titulo', 'notas', 'cedula'],
  }));
  assert.equal(registro.estado, 'Completo');

  const confirmada = await llamar(env, { accion: 'confirmar_pago', id: venta.id, confirmado: true });
  assert.equal(confirmada.venta.estado_pago, 'Confirmado');
  assert.equal(confirmada.venta.cliente, 'David Andres Lasso Garcia');
  assert.equal(confirmada.venta.registro.cedula, '1088357834');
  assert.equal(confirmada.venta.registro.correo, 'david@correo.com');
  assert.equal(confirmada.venta.historial.length, 4);
});

test('avisa cuando el soporte no coincide con el valor de la venta', async () => {
  const env = entornoDePrueba();
  await llamar(env, VENTA);
  const pago = await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '1.000.000' }));
  assert.equal(pago.comparacion, 'pago menor');
  assert.equal(pago.diferencia, -250000);
});

test('un numero sin venta no puede guardar nada', async () => {
  const env = entornoDePrueba();
  await llamar(env, VENTA);
  assert.equal((await llamar(env, desdeElChat('573009999999', { accion: 'consultar_venta' }))).encontrada, false);
  assert.equal((await llamar(env, desdeElChat('573009999999', { accion: 'guardar_pago', valor: '1' }))).ok, false);
});

test('el agente no recibe datos personales al consultar la venta', async () => {
  const env = entornoDePrueba();
  await llamar(env, { ...VENTA, cliente: 'Cliente Reservado' });
  const consulta = await llamar(env, desdeElChat('573001234567', { accion: 'consultar_venta' }));
  assert.equal(JSON.stringify(consulta).includes('Reservado'), false);
  assert.equal(JSON.stringify(consulta).includes('3001234567'), false);
});

test('no se puede cambiar un pago que Contabilidad ya confirmo', async () => {
  const env = entornoDePrueba();
  const { venta } = await llamar(env, VENTA);
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '1.250.000' }));
  await llamar(env, { accion: 'confirmar_pago', id: venta.id, confirmado: true });
  const otro = await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '5' }));
  assert.equal(otro.ok, false);
});

test('rechaza ventas con datos invalidos', async () => {
  const env = entornoDePrueba();
  assert.equal((await llamar(env, { ...VENTA, telefono: '123' })).ok, false);
  assert.equal((await llamar(env, { ...VENTA, valor: '0' })).ok, false);
  assert.equal((await llamar(env, { ...VENTA, servicio: '' })).ok, false);
});

test('la version publica exige la clave y no acepta llamadas de herramienta', async () => {
  const env = entornoDePrueba({ CLAVE_PANEL: 'clave-de-prueba' });
  assert.equal((await llamar(env, { accion: 'listar' })).estado, 401);
  assert.equal((await llamar(env, { accion: 'listar' }, { 'x-demo-token': 'otra' })).estado, 401);
  assert.equal((await llamar(env, { accion: 'listar' }, { 'x-demo-token': 'clave-de-prueba' })).ok, true);
  const herramienta = await llamar(env, desdeElChat('573001234567', { accion: 'consultar_venta' }), { 'x-demo-token': 'clave-de-prueba' });
  assert.equal(herramienta.ok, false);
});

test('la etapa del cliente avanza con el pago, el registro y lo que marca la asesora', async () => {
  const env = entornoDePrueba();
  const { venta } = await llamar(env, VENTA);
  assert.equal(venta.etapa, 'Pendiente de pago');
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '1.250.000' }));
  assert.equal((await llamar(env, { accion: 'ver', id: venta.id })).venta.etapa, 'Pendiente de registro');
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_registro', documentos_recibidos: 'titulo, cedula', correo: 'a@b.co' }));
  assert.equal((await llamar(env, { accion: 'ver', id: venta.id })).venta.etapa, 'Faltan documentos');
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_registro', documentos_recibidos: 'titulo, notas, cedula', correo: 'a@b.co' }));
  assert.equal((await llamar(env, { accion: 'ver', id: venta.id })).venta.etapa, 'Pago por confirmar');
  assert.equal((await llamar(env, { accion: 'cambiar_etapa', id: venta.id, etapa: 'Enviado' })).ok, false);
  await llamar(env, { accion: 'confirmar_pago', id: venta.id, confirmado: true });
  assert.equal((await llamar(env, { accion: 'ver', id: venta.id })).venta.etapa, 'Listo para radicar');
  assert.equal((await llamar(env, { accion: 'cambiar_etapa', id: venta.id, etapa: 'Radicado en el MEN' })).venta.etapa, 'Radicado en el MEN');
  assert.equal((await llamar(env, { accion: 'cambiar_etapa', id: venta.id, etapa: 'Inventada' })).ok, false);
});
