// Pruebas del sistema de demostracion. Se ejecutan con: node --test kapso/crm-demo/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// La funcion se despliega tal cual en Kapso (sin export), asi que aqui se carga como texto.
const codigo = readFileSync(join(__dirname, 'index.js'), 'utf8');
const { handler, leerValor, compararPago, compararConMoneda, mismoTelefono, estadoDelRegistro, elegirAsesora } = new Function(
  `${codigo}; return { handler, leerValor, compararPago, compararConMoneda, mismoTelefono, estadoDelRegistro, elegirAsesora };`,
)();

/** Base de datos y almacen en memoria con la misma forma que usa la funcion. */
function entornoDePrueba(secretos = {}) {
  const filas = new Map();
  const columnas = ['id', 'creada', 'actualizada', 'cliente', 'telefono', 'servicio', 'valor', 'asesora', 'estado_pago', 'estado_registro', 'pago', 'registro', 'historial', 'codigo', 'moneda', 'tasa'];
  const sentencia = (sql, valores = []) => ({
    bind: (...nuevos) => sentencia(sql, nuevos),
    run: async () => {
      if (sql.startsWith('INSERT')) filas.set(valores[0], Object.fromEntries(columnas.map((columna, i) => [columna, valores[i]])));
      if (sql.startsWith('UPDATE demo_ventas SET codigo')) return;
      if (sql.startsWith('UPDATE')) {
        const [servicio, valor, moneda, tasa, actualizada, cliente, estado_pago, estado_registro, pago, registro, historial, etapa_manual, id] = valores;
        filas.set(id, { ...filas.get(id), servicio, valor, moneda, tasa, actualizada, cliente, estado_pago, estado_registro, pago, registro, historial, etapa_manual });
      }
      if (sql.startsWith('ALTER')) throw new Error('duplicate column name');
      if (sql.startsWith('DELETE')) filas.delete(valores[0]);
    },
    all: async () => ({ results: [...filas.values()].sort((a, b) => b.creada.localeCompare(a.creada)) }),
    first: async () => (sql.includes('WHERE codigo') ? [...filas.values()].find((fila) => fila.codigo === valores[0]) : filas.get(valores[0])) || null,
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
  assert.equal((await llamar(env, { accion: 'listar' })).ventas.length, 1);
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

test('el formulario web registra correo y documentos sin exponer datos de la venta', async () => {
  const env = entornoDePrueba();
  const { venta } = await llamar(env, VENTA);
  assert.match(venta.enlace, /\/f\/[0-9a-f]{24}$/);
  const codigo = venta.enlace.split('/f/')[1];
  const vista = await llamar(env, { accion: 'formulario_ver', codigo });
  assert.deepEqual(Object.keys(vista).sort(), ['enviado', 'estado', 'id', 'ok', 'servicio']);
  assert.equal((await llamar(env, { accion: 'formulario_ver', codigo: 'a'.repeat(24) })).ok, false);

  const archivos = { titulo: `ventas/${venta.id}/titulo-1.pdf`, notas: `ventas/${venta.id}/notas-1.pdf`, cedula: `ventas/${venta.id}/cedula-1.pdf` };
  assert.equal((await llamar(env, { accion: 'formulario_enviar', codigo, correo: 'a@b.co', acepta: false, archivos })).ok, false);
  assert.equal((await llamar(env, { accion: 'formulario_enviar', codigo, correo: 'a@b.co', acepta: true, archivos: { ...archivos, cedula: 'ventas/otra/cedula-1.pdf' } })).ok, false);
  const enviado = await llamar(env, { accion: 'formulario_enviar', codigo, correo: 'A@B.co', acepta: true, archivos });
  assert.equal(enviado.estado, 'Completo');
  assert.equal((await llamar(env, { accion: 'formulario_ver', codigo })).enviado, true);
});

test('lo que llega por chat y por formulario se suma sin borrarse', async () => {
  const env = entornoDePrueba();
  const { venta } = await llamar(env, VENTA);
  const codigo = venta.enlace.split('/f/')[1];
  const archivos = { titulo: `ventas/${venta.id}/titulo-1.pdf`, notas: `ventas/${venta.id}/notas-1.pdf`, cedula: `ventas/${venta.id}/cedula-1.pdf` };
  await llamar(env, { accion: 'formulario_enviar', codigo, correo: 'a@b.co', acepta: true, archivos });
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_registro', nombre: 'Felipe Roldan', cedula: '1116156739', documentos_recibidos: 'cedula' }));
  const { venta: final } = await llamar(env, { accion: 'ver', id: venta.id });
  assert.equal(final.registro.correo, 'a@b.co');
  assert.equal(final.registro.nombre, 'Felipe Roldan');
  assert.equal(final.registro.archivos_formulario.titulo, archivos.titulo);
  assert.equal(final.estado_registro, 'Completo');
});

test('la lectura automatica completa los datos sin borrar el correo ni los archivos', async () => {
  const env = entornoDePrueba();
  const { venta } = await llamar(env, VENTA);
  const codigo = venta.enlace.split('/f/')[1];
  const archivos = { titulo: `ventas/${venta.id}/titulo-1.pdf`, notas: `ventas/${venta.id}/notas-1.pdf`, cedula: `ventas/${venta.id}/cedula-1.pdf` };
  await llamar(env, { accion: 'formulario_enviar', codigo, correo: 'a@b.co', acepta: true, archivos });
  assert.equal((await llamar(env, { accion: 'ver', id: venta.id })).venta.registro.lectura.estado, 'pendiente');
  const leida = await llamar(env, { accion: 'guardar_lectura', id: venta.id, nombre: 'David Andres Lasso Garcia', cedula: '1.088.357.834', universidad: 'UNIR', titulo: 'Master', lectura: { estado: 'hecha', observaciones: '' } });
  assert.equal(leida.venta.cliente, 'David Andres Lasso Garcia');
  assert.equal(leida.venta.registro.cedula, '1088357834');
  assert.equal(leida.venta.registro.correo, 'a@b.co');
  assert.equal(leida.venta.registro.archivos_formulario.cedula, archivos.cedula);
  assert.equal(leida.venta.estado_registro, 'Completo');
  const fallida = await llamar(env, { accion: 'guardar_lectura', id: venta.id, lectura: { estado: 'fallida', observaciones: 'muy pesado' } });
  assert.equal(fallida.venta.registro.lectura.estado, 'fallida');
  assert.equal(fallida.venta.registro.nombre, 'David Andres Lasso Garcia');
});

test('compara pagos hechos en la otra moneda usando la tasa de la venta', () => {
  const enEuros = { valor: 250, moneda: 'EUR', tasa: 4500 };
  assert.equal(compararConMoneda(enEuros, 250, 'EUR').resultado, 'coincide');
  assert.equal(compararConMoneda(enEuros, 250, '€').resultado, 'coincide');
  const enPesos = compararConMoneda(enEuros, 1140000, 'COP');
  assert.equal(enPesos.resultado, 'coincide');
  assert.equal(enPesos.esperado, 1125000);
  assert.equal(compararConMoneda(enEuros, 900000, 'pesos').resultado, 'pago menor');
  assert.equal(compararConMoneda(enEuros, 1300000, 'COP').resultado, 'pago mayor');
  assert.equal(compararConMoneda({ valor: 1125000, moneda: 'COP', tasa: 4500 }, 250, 'EUR').resultado, 'coincide');
  assert.equal(compararConMoneda({ valor: 1125000, moneda: 'COP', tasa: null }, 250, 'EUR').resultado, 'moneda distinta');
  assert.equal(compararConMoneda(enEuros, 300, 'USD').resultado, 'moneda distinta');
  assert.equal(compararConMoneda({ valor: 350000 }, 350000, '').resultado, 'coincide');
});

test('una venta en euros exige la tasa y guarda el pago con su conversion', async () => {
  const env = entornoDePrueba();
  assert.equal((await llamar(env, { ...VENTA, valor: '250', moneda: 'EUR' })).ok, false);
  assert.equal((await llamar(env, { ...VENTA, valor: '250', moneda: 'USD', tasa: '4000' })).ok, false);
  const { venta } = await llamar(env, { ...VENTA, valor: '250', moneda: 'EUR', tasa: '4.500' });
  assert.equal(venta.moneda, 'EUR');
  assert.equal(venta.tasa, 4500);
  assert.equal((await llamar(env, desdeElChat('573001234567', { accion: 'consultar_venta' }))).moneda, 'EUR');
  const pago = await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '$ 1.125.000', moneda: 'COP' }));
  assert.equal(pago.comparacion, 'coincide');
  const guardada = (await llamar(env, { accion: 'ver', id: venta.id })).venta.pago;
  assert.equal(guardada.valor_esperado, 1125000);
  assert.equal(guardada.moneda_venta, 'EUR');
  assert.equal(guardada.tasa, 4500);
});

test('la IA registra la cotizacion del chat como venta y no la duplica', async () => {
  const env = entornoDePrueba();
  const primera = await llamar(env, desdeElChat('573001234567', { accion: 'registrar_cotizacion', servicio: 'Apostilla de titulo', valor: '250', moneda: 'EUR', tasa: '4500' }));
  assert.equal(primera.creada, true);
  assert.equal(primera.valor_esperado, 250);
  const segunda = await llamar(env, desdeElChat('573001234567', { accion: 'registrar_cotizacion', servicio: 'Otra', valor: '999' }));
  assert.equal(segunda.creada, false);
  assert.equal(segunda.valor_esperado, 250);
  const { ventas } = await llamar(env, { accion: 'listar' });
  assert.equal(ventas.length, 1);
  assert.match(ventas[0].historial.at(-1).hecho, /creada por la IA/);
  assert.equal((await llamar(env, desdeElChat('573001234567', { accion: 'registrar_cotizacion', servicio: 'X', valor: '0' }))).creada, false);
});

test('los documentos pueden llegar antes de cotizar y la asesora pone el precio despues', async () => {
  const env = entornoDePrueba();
  const registro = await llamar(env, desdeElChat('573001234567', { accion: 'guardar_registro', nombre: 'David Lasso', cedula: '1088357834', documentos_recibidos: 'titulo, cedula' }));
  assert.equal(registro.cliente_nuevo, true);
  assert.deepEqual(registro.faltantes, ['notas', 'correo']);
  const { ventas } = await llamar(env, { accion: 'listar' });
  assert.equal(ventas.length, 1);
  assert.equal(ventas[0].etapa, 'Por cotizar (faltan documentos)');
  assert.equal(ventas[0].cliente, 'David Lasso');
  assert.equal((await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '350.000' }))).ok, false);
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_registro', documentos_recibidos: 'notas', correo: 'd@x.co' }));
  assert.equal((await llamar(env, { accion: 'ver', id: ventas[0].id })).venta.etapa, 'Por cotizar');
  const cotizada = await llamar(env, { accion: 'cotizar', id: ventas[0].id, servicio: 'Apostilla de titulo y notas', valor: '350.000', moneda: 'COP' });
  assert.equal(cotizada.venta.valor, 350000);
  assert.equal(cotizada.venta.etapa, 'Pendiente de pago');
  assert.equal(cotizada.venta.registro.nombre, 'David Lasso');
  assert.equal((await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '350.000' }))).comparacion, 'coincide');
  assert.equal((await llamar(env, { accion: 'cotizar', id: ventas[0].id, servicio: 'Otro', valor: '1' })).ok, false);
});

test('la IA le pone a un cliente sin precio la cotizacion que escribio la asesora', async () => {
  const env = entornoDePrueba();
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_registro', documentos_recibidos: 'titulo, notas, cedula', correo: 'd@x.co' }));
  const cotizada = await llamar(env, desdeElChat('573001234567', { accion: 'registrar_cotizacion', servicio: 'Apostilla', valor: '250', moneda: 'EUR', tasa: '4500' }));
  assert.equal(cotizada.valor_esperado, 250);
  assert.equal(cotizada.etapa, 'Pendiente de pago');
  assert.equal((await llamar(env, { accion: 'listar' })).ventas.length, 1);
});

test('el cliente puede pagar por abonos y el saldo se va descontando', async () => {
  const env = entornoDePrueba();
  const { venta } = await llamar(env, { ...VENTA, valor: '150', moneda: 'EUR', tasa: '4500' });
  assert.equal((await llamar(env, desdeElChat('573001234567', { accion: 'consultar_venta' }))).enlace_formulario, undefined);
  const abono = await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '75', moneda: 'EUR', archivo_url: 'https://archivos.invalid/soporte1.jpg' }));
  assert.equal(abono.comparacion, 'pago menor');
  assert.equal(abono.saldo_pendiente, 75);
  await llamar(env, { accion: 'confirmar_pago', id: venta.id, confirmado: true });
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_registro', documentos_recibidos: 'titulo, notas, cedula', correo: 'a@b.co' }));
  assert.equal((await llamar(env, { accion: 'ver', id: venta.id })).venta.etapa, 'Saldo pendiente');
  const resto = await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '340.000', moneda: 'COP' }));
  assert.equal(resto.comparacion, 'coincide');
  assert.equal(resto.saldo_pendiente, 0);
  const final = (await llamar(env, { accion: 'ver', id: venta.id })).venta;
  assert.equal(final.pago.pagos.length, 2);
  assert.equal(final.pago.pagos[0].archivo, 'https://archivos.invalid/soporte1.jpg');
  assert.equal(final.estado_pago, 'Por confirmar');
  await llamar(env, { accion: 'confirmar_pago', id: venta.id, confirmado: true });
  assert.equal((await llamar(env, desdeElChat('573001234567', { accion: 'guardar_pago', valor: '10', moneda: 'EUR' }))).ok, false);
});

test('los documentos del chat quedan adjuntos al cliente sin que el use el formulario', async () => {
  const env = entornoDePrueba();
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_registro', documentos_recibidos: 'titulo', archivo_titulo: 'https://archivos.invalid/t.pdf', archivo_notas: 'javascript:alert(1)' }));
  await llamar(env, desdeElChat('573001234567', { accion: 'guardar_registro', documentos_recibidos: 'cedula', archivo_cedula: 'https://archivos.invalid/c.jpg' }));
  const { ventas } = await llamar(env, { accion: 'listar' });
  assert.deepEqual(ventas[0].registro.archivos_chat, { titulo: 'https://archivos.invalid/t.pdf', cedula: 'https://archivos.invalid/c.jpg' });
});

test('la asesora puede corregir los datos y registrar un pago a mano', async () => {
  const env = entornoDePrueba();
  const { venta } = await llamar(env, VENTA);
  const corregida = await llamar(env, { accion: 'editar_registro', id: venta.id, nombre: 'Bertha Rivera', cedula: '52.963.649', correo: 'b@x.co', documentos_recibidos: 'titulo, notas, cedula' });
  assert.equal(corregida.venta.cliente, 'Bertha Rivera');
  assert.equal(corregida.venta.registro.cedula, '52963649');
  assert.equal(corregida.venta.estado_registro, 'Completo');
  assert.equal((await llamar(env, { accion: 'editar_registro', id: venta.id, correo: 'malo' })).ok, false);
  const pagada = await llamar(env, { accion: 'registrar_pago', id: venta.id, valor: '250.000', moneda: 'COP', medio: 'Efectivo' });
  assert.equal(pagada.venta.pago.saldo, 1000000);
  assert.equal(pagada.venta.pago.pagos[0].observaciones, 'Registrado a mano en la plataforma');
  assert.equal((await llamar(env, { accion: 'confirmar_pago', id: venta.id, confirmado: true })).venta.estado_pago, 'Confirmado');
});
