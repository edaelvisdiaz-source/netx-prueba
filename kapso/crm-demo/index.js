// Sistema de demostracion de apostillas: ventas, soportes de pago y registros de clientes.
// Sirve solo para ensayar el flujo de WhatsApp mientras el CRM real no esta en linea.
//
// Se despliega dos veces con el mismo codigo:
//  - Privada (sin secreto CLAVE_PANEL): la usan los agentes del flujo como herramienta y las
//    llamadas con la llave de Kapso.
//  - Publica (con secreto CLAVE_PANEL): la usa la pantalla del sistema. Exige la clave en el
//    encabezado X-Demo-Token y no acepta llamadas de herramienta.
//
// Kapso exige una funcion `handler(request, env)` sin `export`.

const TITULARES = ['Estefania Diaz', 'Melissa Orellano'];
const REEMPLAZO = 'Andrea Martinez';
const DIA_DEL_REEMPLAZO = 'Sat';
const ZONA_HORARIA = 'America/Bogota';
const PAGO = { SIN_SOPORTE: 'Sin soporte', POR_CONFIRMAR: 'Por confirmar', CONFIRMADO: 'Confirmado', RECHAZADO: 'Rechazado' };
const REGISTRO = { PENDIENTE: 'Pendiente', FALTAN: 'Faltan documentos', COMPLETO: 'Completo' };
// Etapas que la asesora marca a mano una vez el pago esta confirmado y el registro completo.
const ETAPAS_MANUALES = ['Radicado en el MEN', 'Enviado', 'Apostillado'];
const DOCUMENTOS_OBLIGATORIOS = ['titulo', 'notas', 'cedula'];
// Direccion publica de la pantalla; el formulario de cada venta es esta direccion mas su codigo.
const ENLACE_FORMULARIO = 'https://y5b7snu3g3rvlebookdtwtagiq0yjksw.lambda-url.us-east-1.on.aws/f/';
const MONEDAS = ['COP', 'EUR'];
// Al convertir entre monedas la tasa del banco nunca es exacta: se acepta esta diferencia.
const TOLERANCIA_AL_CONVERTIR = 0.03;
const MAXIMO_TEXTO = 500;
const MAXIMO_LISTA = 200;
const DIGITOS_PARA_COMPARAR = 10;
const TABLA = `CREATE TABLE IF NOT EXISTS demo_ventas (
  id TEXT PRIMARY KEY, creada TEXT NOT NULL, actualizada TEXT NOT NULL, cliente TEXT, telefono TEXT NOT NULL,
  servicio TEXT NOT NULL, valor INTEGER NOT NULL, asesora TEXT NOT NULL, estado_pago TEXT NOT NULL,
  estado_registro TEXT NOT NULL, pago TEXT, registro TEXT, historial TEXT NOT NULL, etapa_manual TEXT, codigo TEXT, moneda TEXT, tasa REAL)`;

class ErrorDeUso extends Error {}

function json(cuerpo, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
}

function texto(valor) {
  return valor === undefined || valor === null ? '' : String(valor).trim().slice(0, MAXIMO_TEXTO);
}

function soloDigitos(valor) {
  return texto(valor).replace(/\D/g, '');
}

/** Dos telefonos son el mismo si coinciden sus ultimos diez digitos (sin indicativo de pais). */
function mismoTelefono(a, b) {
  const x = soloDigitos(a).slice(-DIGITOS_PARA_COMPARAR);
  const y = soloDigitos(b).slice(-DIGITOS_PARA_COMPARAR);
  return x.length >= 7 && x === y;
}

/** Convierte "$ 1.250.000", "1,250,000.00" o 1250000 en un numero entero de pesos. */
function leerValor(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor) : null;
  const limpio = texto(valor).replace(/[^\d.,]/g, '');
  if (!/\d/.test(limpio)) return null;
  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');
  const separador = Math.max(ultimoPunto, ultimaComa);
  const decimales = separador === -1 ? 0 : limpio.length - separador - 1;
  const hayDosTipos = ultimoPunto !== -1 && ultimaComa !== -1;
  const unSoloSeparador = limpio.split(/[.,]/).length === 2;
  // Un separador seguido de tres digitos es de miles; con uno o dos digitos, es decimal.
  const esDecimal = decimales > 0 && decimales !== 3 && (hayDosTipos || unSoloSeparador);
  const entero = esDecimal ? limpio.slice(0, separador) : limpio;
  const numero = Number(entero.replace(/[.,]/g, ''));
  return Number.isFinite(numero) ? numero : null;
}

function compararPago(valorEsperado, valorPagado) {
  if (valorPagado === null) return { resultado: 'valor no legible', diferencia: null };
  const diferencia = valorPagado - valorEsperado;
  if (diferencia === 0) return { resultado: 'coincide', diferencia };
  return { resultado: diferencia < 0 ? 'pago menor' : 'pago mayor', diferencia };
}

function leerMoneda(valor) {
  const limpia = texto(valor).toUpperCase();
  if (/EUR|€/.test(limpia)) return 'EUR';
  if (/COP|PESO|\$/.test(limpia)) return 'COP';
  return limpia;
}

/**
 * Compara el pago con la venta teniendo en cuenta la moneda. Si el cliente paga en la otra moneda
 * se convierte con la tasa de la venta (pesos por euro) y se acepta una pequena diferencia.
 */
function compararConMoneda(venta, valorPagado, monedaDelPago) {
  const monedaVenta = venta.moneda || 'COP';
  const monedaPago = leerMoneda(monedaDelPago) || monedaVenta;
  if (valorPagado === null) return { resultado: 'valor no legible', diferencia: null, moneda: monedaPago, esperado: venta.valor };
  if (monedaPago === monedaVenta) return { ...compararPago(venta.valor, valorPagado), moneda: monedaPago, esperado: venta.valor };
  const convertible = MONEDAS.includes(monedaPago) && venta.tasa > 0;
  if (!convertible) return { resultado: 'moneda distinta', diferencia: null, moneda: monedaPago, esperado: venta.valor };
  const esperado = Math.round(monedaPago === 'COP' ? venta.valor * venta.tasa : venta.valor / venta.tasa);
  const diferencia = valorPagado - esperado;
  const dentro = Math.abs(diferencia) <= esperado * TOLERANCIA_AL_CONVERTIR;
  return { resultado: dentro ? 'coincide' : diferencia < 0 ? 'pago menor' : 'pago mayor', diferencia, moneda: monedaPago, esperado, convertido: true };
}

function estadoDelRegistro(recibidos, correo) {
  const tiene = new Set(recibidos.map((nombre) => nombre.toLowerCase()));
  const faltantes = DOCUMENTOS_OBLIGATORIOS.filter((nombre) => !tiene.has(nombre));
  if (!correo) faltantes.push('correo');
  return { estado: faltantes.length ? REGISTRO.FALTAN : REGISTRO.COMPLETO, faltantes };
}

/** En que va el cliente, en una sola frase: es lo que se muestra en la lista. */
function etapaDe(venta) {
  // Cliente que ya envio documentos pero al que la asesora aun no le ha cotizado.
  if (!(venta.valor > 0)) return venta.estado_registro === REGISTRO.FALTAN ? 'Por cotizar (faltan documentos)' : 'Por cotizar';
  if (venta.estado_pago === PAGO.RECHAZADO) return 'Pago rechazado';
  if (venta.estado_pago === PAGO.SIN_SOPORTE) return 'Pendiente de pago';
  if (venta.estado_registro === REGISTRO.FALTAN) return 'Faltan documentos';
  if (venta.estado_registro === REGISTRO.PENDIENTE) return 'Pendiente de registro';
  if (venta.estado_pago === PAGO.POR_CONFIRMAR) return 'Pago por confirmar';
  return venta.etapa_manual || 'Listo para radicar';
}

function elegirAsesora(diaDeLaSemana, turno) {
  if (diaDeLaSemana === DIA_DEL_REEMPLAZO) return { asesora: REEMPLAZO, turno };
  return { asesora: TITULARES[turno % TITULARES.length], turno: turno + 1 };
}

function diaLocal(fecha) {
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HORARIA, weekday: 'short' }).format(fecha);
}

/** Codigo del enlace del formulario: imposible de adivinar, porque es lo unico que lo protege. */
function nuevoCodigo() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function estaVacio(valor) {
  return valor === '' || valor === null || valor === undefined || (Array.isArray(valor) && valor.length === 0);
}

/** Une lo ya registrado con lo nuevo sin borrar datos: el chat y el formulario se complementan. */
function unirRegistro(anterior, nuevo) {
  const unido = { ...(anterior || {}) };
  for (const [clave, valor] of Object.entries(nuevo)) if (!estaVacio(valor)) unido[clave] = valor;
  const recibidos = [...(anterior?.documentos_recibidos || []), ...(nuevo.documentos_recibidos || [])].map((nombre) => nombre.toLowerCase());
  return { ...unido, documentos_recibidos: [...new Set(recibidos)] };
}

function lista(valor) {
  const elementos = Array.isArray(valor) ? valor : texto(valor).split(',');
  return elementos.map(texto).filter(Boolean).slice(0, 20);
}

function telefonoDelChat(cuerpo) {
  const contexto = cuerpo.execution_context?.context || {};
  const whatsapp = cuerpo.whatsapp_context || {};
  return soloDigitos(
    contexto.phone_number || whatsapp.phone_number || whatsapp.conversation?.phone_number || whatsapp.contact?.phone_number || whatsapp.contact?.wa_id,
  );
}

function aVenta(fila) {
  const venta = { ...fila, pago: fila.pago ? JSON.parse(fila.pago) : null, registro: fila.registro ? JSON.parse(fila.registro) : null, historial: JSON.parse(fila.historial) };
  return { ...venta, etapa: etapaDe(venta), enlace: fila.codigo ? ENLACE_FORMULARIO + fila.codigo : null };
}

function conHistorial(venta, ahora, hecho) {
  return [...venta.historial, { fecha: ahora, hecho }].slice(-50);
}

async function todas(env) {
  const { results } = await env.DB.prepare('SELECT * FROM demo_ventas ORDER BY creada DESC LIMIT ?').bind(MAXIMO_LISTA).all();
  return results.map(aVenta);
}

async function porId(env, id) {
  const fila = await env.DB.prepare('SELECT * FROM demo_ventas WHERE id = ?').bind(texto(id)).first();
  if (!fila) throw new ErrorDeUso('No existe esa venta');
  return aVenta(fila);
}

async function porCodigo(env, codigo) {
  const limpio = texto(codigo);
  const fila = /^[0-9a-f]{24}$/.test(limpio) ? await env.DB.prepare('SELECT * FROM demo_ventas WHERE codigo = ?').bind(limpio).first() : null;
  if (!fila) throw new ErrorDeUso('Este enlace no es valido');
  return aVenta(fila);
}

/** La venta mas reciente de ese telefono; es la que el cliente esta tramitando. */
async function porTelefono(env, telefono) {
  return (await todas(env)).find((venta) => mismoTelefono(venta.telefono, telefono)) || null;
}

async function guardar(env, venta, cambios, ahora, hecho) {
  const cambiada = { ...venta, ...cambios, actualizada: ahora, historial: conHistorial(venta, ahora, hecho) };
  const nueva = { ...cambiada, etapa: etapaDe(cambiada) };
  await env.DB.prepare('UPDATE demo_ventas SET servicio = ?, valor = ?, moneda = ?, tasa = ?, actualizada = ?, cliente = ?, estado_pago = ?, estado_registro = ?, pago = ?, registro = ?, historial = ?, etapa_manual = ? WHERE id = ?')
    .bind(nueva.servicio, nueva.valor, nueva.moneda || 'COP', nueva.tasa || null, nueva.actualizada, nueva.cliente, nueva.estado_pago, nueva.estado_registro, nueva.pago ? JSON.stringify(nueva.pago) : null,
      nueva.registro ? JSON.stringify(nueva.registro) : null, JSON.stringify(nueva.historial), nueva.etapa_manual || null, nueva.id)
    .run();
  return nueva;
}

function leerCotizacion(datos) {
  const valor = leerValor(datos.valor);
  const servicio = texto(datos.servicio);
  if (!valor || valor <= 0) throw new ErrorDeUso('El valor de la venta debe ser mayor que cero');
  if (!servicio) throw new ErrorDeUso('Falta el servicio');
  const moneda = leerMoneda(datos.moneda) || 'COP';
  if (!MONEDAS.includes(moneda)) throw new ErrorDeUso('La moneda debe ser COP o EUR');
  const tasa = leerValor(datos.tasa);
  if (moneda === 'EUR' && !(tasa > 0)) throw new ErrorDeUso('Para cotizar en euros escribe la tasa de cambio (pesos por euro)');
  return { servicio, valor, moneda, tasa: tasa > 0 ? tasa : null };
}

/** Pone o cambia el precio de un cliente mientras no haya enviado soporte de pago. */
async function cotizar(env, venta, datos, ahora, quien) {
  if (venta.estado_pago !== PAGO.SIN_SOPORTE) throw new ErrorDeUso('Esta venta ya tiene soporte de pago; no se puede cambiar el valor');
  const cotizacion = leerCotizacion(datos);
  const simbolo = cotizacion.moneda === 'EUR' ? 'EUR' : 'COP';
  return guardar(env, venta, cotizacion, ahora, `Cotizado por ${quien}: ${cotizacion.servicio}, ${cotizacion.valor} ${simbolo}`);
}

async function crearVenta(env, datos, ahora, sinCotizar = false) {
  const telefono = soloDigitos(datos.telefono);
  if (telefono.length < 10) throw new ErrorDeUso('El telefono debe tener al menos 10 digitos');
  const { servicio, valor, moneda, tasa } = sinCotizar ? { servicio: 'Por cotizar', valor: 0, moneda: 'COP', tasa: null } : leerCotizacion(datos);
  let asesora = texto(datos.asesora);
  if (!asesora) {
    const turno = Number(await env.KV.get('demo:turno')) || 0;
    const decision = elegirAsesora(diaLocal(new Date(ahora)), turno);
    asesora = decision.asesora;
    await env.KV.put('demo:turno', String(decision.turno));
  }
  const venta = {
    id: crypto.randomUUID(), creada: ahora, actualizada: ahora, cliente: texto(datos.cliente), telefono, servicio, valor, moneda, tasa, asesora,
    estado_pago: PAGO.SIN_SOPORTE, estado_registro: REGISTRO.PENDIENTE, pago: null, registro: null, etapa_manual: null,
    codigo: nuevoCodigo(), etapa: sinCotizar ? 'Por cotizar' : 'Pendiente de pago',
    historial: [{ fecha: ahora, hecho: `${sinCotizar ? 'Cliente creado al recibir sus documentos' : 'Venta creada'} y asignado a ${asesora}` }],
  };
  await env.DB.prepare('INSERT INTO demo_ventas (id, creada, actualizada, cliente, telefono, servicio, valor, asesora, estado_pago, estado_registro, pago, registro, historial, codigo, moneda, tasa) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(venta.id, venta.creada, venta.actualizada, venta.cliente, venta.telefono, venta.servicio, venta.valor, venta.asesora, venta.estado_pago, venta.estado_registro, null, null, JSON.stringify(venta.historial), venta.codigo, venta.moneda, venta.tasa)
    .run();
  return { ...venta, enlace: ENLACE_FORMULARIO + venta.codigo };
}

async function guardarPago(env, venta, datos, ahora) {
  if (venta.estado_pago === PAGO.CONFIRMADO) throw new ErrorDeUso('El pago de esta venta ya fue confirmado por Contabilidad');
  const valorPagado = leerValor(datos.valor);
  const comparacion = compararConMoneda(venta, valorPagado, datos.moneda);
  const pago = {
    fecha: texto(datos.fecha), valor: valorPagado, moneda: comparacion.moneda, medio: texto(datos.medio), referencia: texto(datos.referencia),
    pagador: texto(datos.pagador), destino: texto(datos.destino), observaciones: texto(datos.observaciones), archivo: texto(datos.archivo_url),
    valor_esperado: comparacion.esperado, moneda_venta: venta.moneda || 'COP', valor_venta: venta.valor, tasa: comparacion.convertido ? venta.tasa : null,
    comparacion: comparacion.resultado, diferencia: comparacion.diferencia, recibido: ahora,
  };
  const nueva = await guardar(env, venta, { pago, estado_pago: PAGO.POR_CONFIRMAR }, ahora, `Soporte de pago recibido: ${comparacion.resultado}`);
  return { venta: nueva, comparacion: comparacion.resultado, diferencia: comparacion.diferencia, valor_esperado: comparacion.esperado, moneda: comparacion.moneda };
}

async function guardarRegistro(env, venta, datos, ahora) {
  const correo = texto(datos.correo).toLowerCase();
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new ErrorDeUso('El correo no tiene un formato valido');
  const registro = unirRegistro(venta.registro, {
    nombre: texto(datos.nombre), cedula: soloDigitos(datos.cedula), fecha_nacimiento: texto(datos.fecha_nacimiento), universidad: texto(datos.universidad),
    titulo: texto(datos.titulo), fecha_grado: texto(datos.fecha_grado), codigo_verificacion: texto(datos.codigo_verificacion), correo,
    documentos_recibidos: lista(datos.documentos_recibidos), legibilidad: texto(datos.legibilidad), diferencias: texto(datos.diferencias),
    archivos: lista(datos.archivos), recibido: ahora,
  });
  return cerrarRegistro(env, venta, registro, ahora, 'por WhatsApp');
}

async function cerrarRegistro(env, venta, registro, ahora, origen) {
  const { estado, faltantes } = estadoDelRegistro(registro.documentos_recibidos, registro.correo);
  const completo = { ...registro, documentos_faltantes: faltantes };
  const cambios = { registro: completo, estado_registro: estado, cliente: completo.nombre || venta.cliente };
  const hecho = estado === REGISTRO.COMPLETO ? `Registro completo (${origen})` : `Registro ${origen} con faltantes: ${faltantes.join(', ')}`;
  const nueva = await guardar(env, venta, cambios, ahora, hecho);
  return { venta: nueva, estado, faltantes };
}

/** Guarda lo que la lectura automatica saco de los documentos del formulario. */
async function guardarLectura(env, datos, ahora) {
  const venta = await porId(env, datos.id);
  if (!venta.registro) throw new ErrorDeUso('Esta venta no tiene registro');
  const estado = datos.lectura?.estado === 'hecha' ? 'hecha' : 'fallida';
  const lectura = { estado, observaciones: texto(datos.lectura?.observaciones), fecha: ahora };
  if (estado === 'fallida') {
    return { ok: true, venta: await guardar(env, venta, { registro: { ...venta.registro, lectura } }, ahora, 'Lectura automática fallida: revisar documentos a mano') };
  }
  const registro = unirRegistro(venta.registro, {
    nombre: texto(datos.nombre), cedula: texto(datos.cedula).replace(/[.\s]/g, ''), fecha_nacimiento: texto(datos.fecha_nacimiento), universidad: texto(datos.universidad),
    titulo: texto(datos.titulo), fecha_grado: texto(datos.fecha_grado), codigo_verificacion: texto(datos.codigo_verificacion),
    legibilidad: texto(datos.legibilidad), diferencias: texto(datos.diferencias), lectura,
  });
  return { ok: true, venta: (await cerrarRegistro(env, venta, registro, ahora, 'leído con IA')).venta };
}

/** Lo minimo que ve quien abre el enlace: nada de valores, telefonos ni datos ya registrados. */
async function verFormulario(env, datos) {
  const venta = await porCodigo(env, datos.codigo);
  return { ok: true, id: venta.id, servicio: venta.servicio, enviado: Boolean(venta.registro?.archivos_formulario) };
}

async function enviarFormulario(env, datos, ahora) {
  const venta = await porCodigo(env, datos.codigo);
  const correo = texto(datos.correo).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new ErrorDeUso('Escribe un correo valido');
  if (datos.acepta !== true) throw new ErrorDeUso('Debes aceptar los terminos y la politica de privacidad');
  const archivos = {};
  for (const documento of DOCUMENTOS_OBLIGATORIOS) {
    const ruta = texto(datos.archivos?.[documento]);
    if (!ruta.startsWith(`ventas/${venta.id}/${documento}-`)) throw new ErrorDeUso(`Falta el documento: ${documento}`);
    archivos[documento] = ruta;
  }
  const registro = unirRegistro(venta.registro, { correo, documentos_recibidos: DOCUMENTOS_OBLIGATORIOS, archivos_formulario: archivos, acepto_terminos: ahora, recibido: ahora, lectura: { estado: 'pendiente', observaciones: '' } });
  const { estado } = await cerrarRegistro(env, venta, registro, ahora, 'por formulario');
  return { ok: true, estado };
}

async function confirmarPago(env, datos, ahora) {
  const venta = await porId(env, datos.id);
  if (!venta.pago) throw new ErrorDeUso('Esta venta todavia no tiene soporte de pago');
  const estado = datos.confirmado ? PAGO.CONFIRMADO : PAGO.RECHAZADO;
  const nota = texto(datos.nota);
  return guardar(env, venta, { estado_pago: estado }, ahora, `Contabilidad: pago ${estado.toLowerCase()}${nota ? ` (${nota})` : ''}`);
}

async function cambiarEtapa(env, datos, ahora) {
  const venta = await porId(env, datos.id);
  const etapa = texto(datos.etapa);
  if (etapa && !ETAPAS_MANUALES.includes(etapa)) throw new ErrorDeUso('Esa etapa no existe');
  if (venta.estado_pago !== PAGO.CONFIRMADO || venta.estado_registro !== REGISTRO.COMPLETO) {
    throw new ErrorDeUso('Primero deben estar el pago confirmado y el registro completo');
  }
  return guardar(env, venta, { etapa_manual: etapa || null }, ahora, `Etapa: ${etapa || 'Listo para radicar'}`);
}

/** Lo que el agente puede saber de una venta: nada de datos de otros clientes. */
function paraElAgente(venta) {
  if (!venta) return { encontrada: false };
  return { encontrada: true, etapa: venta.etapa, enlace_formulario: venta.enlace, servicio: venta.servicio, valor_esperado: venta.valor, moneda: venta.moneda || 'COP', asesora: venta.asesora, estado_pago: venta.estado_pago, estado_registro: venta.estado_registro };
}

async function comoHerramienta(env, cuerpo, ahora) {
  const entrada = cuerpo.input;
  const venta = await porTelefono(env, telefonoDelChat(cuerpo));
  if (entrada.accion === 'consultar_venta') return paraElAgente(venta);
  if (entrada.accion === 'registrar_cotizacion') {
    // Cliente que ya envio documentos y aun no tiene precio: se le pone el que escribio la asesora.
    if (venta && !(venta.valor > 0)) return { ok: true, creada: true, ...paraElAgente(await cotizar(env, venta, entrada, ahora, 'la IA a partir del chat (verificar)')) };
    // Si ya tiene una venta sin pagar no se crea otra: la asesora la ajusta en la plataforma.
    if (venta && venta.estado_pago === PAGO.SIN_SOPORTE) return { ok: true, creada: false, ...paraElAgente(venta) };
    const nueva = await crearVenta(env, { ...entrada, telefono: telefonoDelChat(cuerpo) }, ahora);
    await guardar(env, { ...nueva, historial: nueva.historial }, {}, ahora, 'Venta creada por la IA a partir de la cotización del chat: verificar');
    return { ok: true, creada: true, ...paraElAgente(await porId(env, nueva.id)) };
  }
  if (entrada.accion === 'guardar_registro' && !venta) {
    // Los documentos pueden llegar antes de cotizar: se crea el cliente y la asesora le pone el precio despues.
    const prospecto = await crearVenta(env, { telefono: telefonoDelChat(cuerpo) }, ahora, true);
    const { estado, faltantes } = await guardarRegistro(env, prospecto, entrada, ahora);
    return { ok: true, estado, faltantes, asesora: prospecto.asesora, cliente_nuevo: true, vars: { registro_estado: estado } };
  }
  if (!venta) return { ok: false, error: 'Este numero no tiene una venta registrada en el sistema' };
  if (entrada.accion === 'guardar_pago') {
    if (!(venta.valor > 0)) return { ok: false, error: 'Este cliente aun no tiene cotizacion: la asesora debe ponerle el valor antes de registrar el pago' };
    const { comparacion, diferencia, valor_esperado, moneda } = await guardarPago(env, venta, entrada, ahora);
    return { ok: true, comparacion, diferencia, valor_esperado, moneda, vars: { pago_comparacion: comparacion } };
  }
  if (entrada.accion === 'guardar_registro') {
    const { estado, faltantes } = await guardarRegistro(env, venta, entrada, ahora);
    return { ok: true, estado, faltantes, asesora: venta.asesora, vars: { registro_estado: estado } };
  }
  throw new ErrorDeUso('Accion de herramienta desconocida');
}

async function comoPanel(env, cuerpo, ahora) {
  switch (cuerpo.accion) {
    case 'listar': return { ok: true, ventas: await todas(env), asesoras: [...TITULARES, REEMPLAZO], etapas: ETAPAS_MANUALES };
    case 'formulario_ver': return verFormulario(env, cuerpo);
    case 'guardar_lectura': return guardarLectura(env, cuerpo, ahora);
    case 'formulario_enviar': return enviarFormulario(env, cuerpo, ahora);
    case 'cotizar': return { ok: true, venta: await cotizar(env, await porId(env, cuerpo.id), cuerpo, ahora, 'la asesora') };
    case 'cambiar_etapa': return { ok: true, venta: await cambiarEtapa(env, cuerpo, ahora) };
    case 'crear_venta': return { ok: true, venta: await crearVenta(env, cuerpo, ahora) };
    case 'ver': return { ok: true, venta: await porId(env, cuerpo.id) };
    case 'confirmar_pago': return { ok: true, venta: await confirmarPago(env, cuerpo, ahora) };
    case 'eliminar':
      await porId(env, cuerpo.id);
      await env.DB.prepare('DELETE FROM demo_ventas WHERE id = ?').bind(texto(cuerpo.id)).run();
      return { ok: true };
    default: throw new ErrorDeUso('Accion desconocida');
  }
}

function clavesIguales(a, b) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

async function handler(request, env) {
  const cuerpo = await request.json().catch(() => ({}));
  const esPublica = Boolean(env.CLAVE_PANEL);
  if (esPublica && !clavesIguales(request.headers.get('x-demo-token') || '', env.CLAVE_PANEL)) return json({ ok: false, error: 'Clave incorrecta' }, 401);
  const ahora = new Date().toISOString();
  try {
    await env.DB.prepare(TABLA).run();
    // Las tablas creadas antes de que existieran las etapas no tienen la columna; si ya esta, la orden falla y se ignora.
    await env.DB.prepare('ALTER TABLE demo_ventas ADD COLUMN etapa_manual TEXT').run().catch(() => undefined);
    await env.DB.prepare('ALTER TABLE demo_ventas ADD COLUMN codigo TEXT').run().catch(() => undefined);
    await env.DB.prepare('ALTER TABLE demo_ventas ADD COLUMN moneda TEXT').run().catch(() => undefined);
    await env.DB.prepare('ALTER TABLE demo_ventas ADD COLUMN tasa REAL').run().catch(() => undefined);
    await env.DB.prepare('UPDATE demo_ventas SET codigo = lower(hex(randomblob(12))) WHERE codigo IS NULL').run();
    const esHerramienta = cuerpo.input && typeof cuerpo.input === 'object';
    if (esHerramienta && esPublica) throw new ErrorDeUso('Accion desconocida');
    return json(esHerramienta ? await comoHerramienta(env, cuerpo, ahora) : await comoPanel(env, cuerpo, ahora));
  } catch (error) {
    if (error instanceof ErrorDeUso) return json({ ok: false, error: error.message }, 200);
    return json({ ok: false, error: 'Error interno del sistema de demostracion' }, 500);
  }
}
