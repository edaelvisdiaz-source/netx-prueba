// Pagina unica del sistema demo. Todo dato se inserta como texto (textContent), nunca como HTML:
// los nombres y observaciones vienen de documentos que envia el cliente.
export const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Apostillas · Demo</title>
<style nonce="__NONCE__">
:root{--fondo:#f4f5f7;--tarjeta:#fff;--texto:#1c2430;--suave:#5b6675;--borde:#dfe3e8;--marca:#1f5fbf;--ok:#1a7f4b;--alerta:#b45309;--mal:#b3261e;--gris:#6b7280}
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--fondo);color:var(--texto)}
header{background:#14213d;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
header h1{font-size:17px;margin:0;flex:1}
header small{opacity:.75}
main{max-width:1100px;margin:0 auto;padding:16px}
button{font:inherit;border:1px solid var(--borde);background:#fff;color:var(--texto);border-radius:8px;padding:8px 12px;cursor:pointer;min-height:40px}
button.primario{background:var(--marca);border-color:var(--marca);color:#fff}
button.bien{background:var(--ok);border-color:var(--ok);color:#fff}
button.mal{background:#fff;border-color:var(--mal);color:var(--mal)}
button:disabled{opacity:.5;cursor:default}
header button{background:transparent;color:#fff;border-color:rgba(255,255,255,.4)}
.tarjeta{background:var(--tarjeta);border:1px solid var(--borde);border-radius:12px;padding:16px;margin-bottom:14px}
.resumen{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.resumen div{background:var(--tarjeta);border:1px solid var(--borde);border-radius:12px;padding:12px}
.resumen b{display:block;font-size:24px}
.resumen span{color:var(--suave);font-size:13px}
.barra{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
.barra input,.barra select{flex:1;min-width:160px}
input,select,textarea{font:inherit;width:100%;padding:9px 10px;border:1px solid var(--borde);border-radius:8px;background:#fff;color:var(--texto);min-height:40px}
label{display:block;font-size:13px;color:var(--suave);margin:10px 0 4px}
table{width:100%;border-collapse:collapse}
th{font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--suave);text-align:left;padding:8px;border-bottom:1px solid var(--borde)}
td{padding:10px 8px;border-bottom:1px solid var(--borde);vertical-align:top}
tr.fila{cursor:pointer}
tr.fila:hover{background:#f8fafc}
.etiqueta{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:#eef1f5;color:var(--gris);white-space:nowrap}
.etiqueta.ok{background:#e3f4ea;color:var(--ok)}
.etiqueta.alerta{background:#fdf0dc;color:var(--alerta)}
.etiqueta.mal{background:#fbe4e2;color:var(--mal)}
.etiqueta.azul{background:#e3edfb;color:var(--marca)}
.suave{color:var(--suave);font-size:13px}
dd button{margin:0 6px 6px 0;min-height:34px;padding:4px 10px}
.dos{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 12px}
dt{color:var(--suave);font-size:13px}
dd{margin:0;word-break:break-word}
h2{font-size:16px;margin:0 0 10px}
ul.historial{list-style:none;margin:0;padding:0}
ul.historial li{padding:6px 0;border-bottom:1px dashed var(--borde);font-size:14px}
.error{color:var(--mal);margin:10px 0 0;min-height:20px}
.entrada{max-width:360px;margin:12vh auto 0}
.acciones{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.oculto{display:none}
.aviso{background:#fff8e6;border:1px solid #f1d58a;border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:14px}
@media(max-width:700px){.ocultar-movil{display:none}}
</style>
</head>
<body>
<div id="raiz"></div>
<script nonce="__NONCE__">
'use strict';
const raiz = document.getElementById('raiz');
// Tarifas vigentes de apostilla para convalidacion (en euros). 'Con radicacion' suma los 30 euros del MEN.
const TARIFAS = [
  ['Apostilla Turbo (apostilla + radicación MEN en 24 horas hábiles)', 170],
  ['Apostilla Flash (3 días, radicación MEN en 48 horas incluida)', 150],
  ['Apostilla Express (8 días)', 130],
  ['Apostilla Express (8 días) + radicación MEN', 160],
  ['Apostilla Estándar (15 días)', 110],
  ['Apostilla Estándar (15 días) + radicación MEN', 140],
];
const estado = { ventas: [], asesoras: [], etapas: [], filtro: '', buscar: '', abierta: null, reloj: null };

function h(etiqueta, atributos, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos || {})) {
    if (clave === 'clase') nodo.className = valor;
    else if (clave.startsWith('al')) nodo.addEventListener(clave.slice(2).toLowerCase(), valor);
    else if (valor !== false && valor !== null && valor !== undefined) nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  for (const hijo of hijos.flat()) if (hijo !== null && hijo !== undefined && hijo !== false) nodo.append(hijo.nodeType ? hijo : document.createTextNode(String(hijo)));
  return nodo;
}

async function pedir(ruta, datos) {
  const respuesta = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo': '1' }, body: JSON.stringify(datos || {}) });
  const cuerpo = await respuesta.json().catch(() => ({ ok: false, error: 'Respuesta no válida' }));
  if (respuesta.status === 401 && ruta !== '/api/entrar') { pintarEntrada(); throw new Error('Sesión vencida'); }
  if (!cuerpo.ok) throw new Error(cuerpo.error || 'No se pudo completar');
  return cuerpo;
}
const accion = (nombre, datos) => pedir('/api/accion', { accion: nombre, ...datos });

const pesos = (valor, moneda) => valor === null || valor === undefined ? '—' : (moneda === 'EUR' ? '€ ' : '$ ') + Number(valor).toLocaleString('es-CO') + (moneda === 'EUR' ? '' : ' COP');
const fecha = (iso) => iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
function claseDeEtapa(etapa) {
  if (['Apostillado', 'Listo para radicar'].includes(etapa)) return 'ok';
  if (['Pago rechazado'].includes(etapa)) return 'mal';
  if (['Pago por confirmar', 'Faltan documentos'].includes(etapa) || etapa.startsWith('Por cotizar')) return 'alerta';
  if (['Radicado en el MEN', 'Enviado'].includes(etapa)) return 'azul';
  return '';
}
const etiqueta = (texto, clase) => h('span', { clase: 'etiqueta ' + (clase || '') }, texto);

function pintarEntrada(mensaje) {
  clearInterval(estado.reloj);
  const usuario = h('input', { id: 'usuario', autocomplete: 'username', required: true });
  const clave = h('input', { id: 'clave', type: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { clase: 'error', role: 'alert' }, mensaje || '');
  const boton = h('button', { clase: 'primario', type: 'submit' }, 'Entrar');
  const formulario = h('form', { clase: 'tarjeta entrada', alSubmit: async (evento) => {
    evento.preventDefault();
    boton.disabled = true; error.textContent = '';
    try { await pedir('/api/entrar', { usuario: usuario.value.trim(), clave: clave.value }); await cargar(); }
    catch (fallo) { error.textContent = fallo.message; boton.disabled = false; }
  } },
    h('h2', null, 'Apostillas · Sistema demo'),
    h('p', { clase: 'suave' }, 'Versión de prueba para ensayar el registro por WhatsApp.'),
    h('label', { for: 'usuario' }, 'Usuario'), usuario,
    h('label', { for: 'clave' }, 'Contraseña'), clave,
    h('div', { clase: 'acciones' }, boton), error);
  raiz.replaceChildren(formulario);
  usuario.focus();
}

async function cargar() {
  const datos = await accion('listar');
  Object.assign(estado, { ventas: datos.ventas, asesoras: datos.asesoras, etapas: datos.etapas });
  pintar();
  clearInterval(estado.reloj);
  estado.reloj = setInterval(refrescar, 15000);
}

async function refrescar() {
  if (document.hidden || document.querySelector('dialog[open]')) return;
  try { const datos = await accion('listar'); estado.ventas = datos.ventas; pintar(); } catch { /* se reintenta en el siguiente ciclo */ }
}

function cabecera() {
  return h('header', null,
    h('h1', null, 'Apostillas · Sistema demo ', h('small', null, 'datos de prueba')),
    h('button', { alClick: () => abrirNuevaVenta() }, '+ Nueva venta'),
    h('button', { alClick: async () => { await pedir('/api/salir').catch(() => null); pintarEntrada(); } }, 'Salir'));
}

function pintar() {
  if (estado.abierta) {
    const venta = estado.ventas.find((v) => v.id === estado.abierta);
    if (venta) return raiz.replaceChildren(cabecera(), h('main', null, detalle(venta)));
    estado.abierta = null;
  }
  raiz.replaceChildren(cabecera(), h('main', null, resumen(), listado()));
}

function resumen() {
  const cuenta = (prueba) => estado.ventas.filter(prueba).length;
  const cajas = [
    ['Ventas', estado.ventas.length],
    ['Pendientes de pago', cuenta((v) => v.etapa === 'Pendiente de pago')],
    ['Pagos por confirmar', cuenta((v) => v.estado_pago === 'Por confirmar')],
    ['Por cotizar', cuenta((v) => v.etapa.startsWith('Por cotizar'))],
    ['Faltan documentos', cuenta((v) => v.estado_registro === 'Faltan documentos')],
    ['Listos para radicar', cuenta((v) => v.etapa === 'Listo para radicar')],
  ];
  return h('div', { clase: 'resumen' }, cajas.map(([nombre, numero]) => h('div', null, h('b', null, numero), h('span', null, nombre))));
}

function listado() {
  const etapas = [...new Set(estado.ventas.map((v) => v.etapa))];
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre, teléfono o cédula', value: estado.buscar, 'aria-label': 'Buscar',
    alInput: (e) => { estado.buscar = e.target.value; pintarFilas(); } });
  const filtro = h('select', { 'aria-label': 'Filtrar por etapa', alChange: (e) => { estado.filtro = e.target.value; pintarFilas(); } },
    h('option', { value: '' }, 'Todas las etapas'), etapas.map((e) => h('option', { value: e, selected: e === estado.filtro }, e)));
  const cuerpo = h('tbody', { id: 'filas' });
  const tabla = h('div', { clase: 'tarjeta' },
    h('div', { clase: 'barra' }, buscar, filtro),
    h('table', null, h('thead', null, h('tr', null,
      h('th', null, 'Cliente'), h('th', null, 'Etapa'), h('th', { clase: 'ocultar-movil' }, 'Servicio'),
      h('th', null, 'Valor'), h('th', { clase: 'ocultar-movil' }, 'Asesora'), h('th', { clase: 'ocultar-movil' }, 'Actualizada'))), cuerpo));
  setTimeout(pintarFilas, 0);
  return tabla;
}

function pintarFilas() {
  const cuerpo = document.getElementById('filas');
  if (!cuerpo) return;
  const texto = estado.buscar.trim().toLowerCase();
  const visibles = estado.ventas.filter((v) => (!estado.filtro || v.etapa === estado.filtro)
    && (!texto || [v.cliente, v.telefono, v.registro && v.registro.cedula].some((campo) => String(campo || '').toLowerCase().includes(texto))));
  if (!visibles.length) {
    return cuerpo.replaceChildren(h('tr', null, h('td', { colspan: 6, clase: 'suave' },
      estado.ventas.length ? 'Ninguna venta coincide con la búsqueda.' : 'Aún no hay ventas. Crea la primera con «+ Nueva venta».')));
  }
  cuerpo.replaceChildren(...visibles.map((v) => h('tr', { clase: 'fila', tabindex: 0, alClick: () => { estado.abierta = v.id; pintar(); },
    alKeydown: (e) => { if (e.key === 'Enter') { estado.abierta = v.id; pintar(); } } },
    h('td', null, h('div', null, v.cliente || 'Sin nombre todavía'), h('div', { clase: 'suave' }, '+' + v.telefono)),
    h('td', null, etiqueta(v.etapa, claseDeEtapa(v.etapa))),
    h('td', { clase: 'ocultar-movil' }, v.servicio), h('td', null, v.valor > 0 ? pesos(v.valor, v.moneda) : '—'),
    h('td', { clase: 'ocultar-movil' }, v.asesora), h('td', { clase: 'ocultar-movil suave' }, fecha(v.actualizada)))));
}

function campos(pares) {
  return h('dl', null, pares.filter(([, valor]) => valor !== '' && valor !== null && valor !== undefined)
    .flatMap(([nombre, valor]) => [h('dt', null, nombre), h('dd', null, valor)]));
}

async function ejecutar(nombre, datos, error) {
  try { error.textContent = ''; await accion(nombre, datos); await cargar(); }
  catch (fallo) { error.textContent = fallo.message; }
}

function detalle(v) {
  const error = h('p', { clase: 'error', role: 'alert' });
  const pago = v.pago;
  const registro = v.registro;
  const claseComparacion = !pago ? '' : pago.comparacion === 'coincide' ? 'ok' : 'mal';
  const listo = v.estado_pago === 'Confirmado' && v.estado_registro === 'Completo';
  const selector = h('select', { 'aria-label': 'Etapa', disabled: !listo, alChange: (e) => ejecutar('cambiar_etapa', { id: v.id, etapa: e.target.value }, error) },
    h('option', { value: '' }, 'Listo para radicar'), estado.etapas.map((e) => h('option', { value: e, selected: v.etapa_manual === e }, e)));
  return h('div', null,
    h('div', { clase: 'barra' }, h('button', { alClick: () => { estado.abierta = null; pintar(); } }, '← Volver'),
      h('h2', null, v.cliente || 'Sin nombre todavía'), etiqueta(v.etapa, claseDeEtapa(v.etapa))),
    h('div', { clase: 'dos' },
      h('div', { clase: 'tarjeta' }, h('h2', null, 'Venta'),
        campos([['WhatsApp', '+' + v.telefono], ['Servicio', v.servicio], ['Valor', v.valor > 0 ? pesos(v.valor, v.moneda) : 'Sin cotizar'], ['Tasa de cambio', v.tasa ? pesos(v.tasa) + ' por euro' : ''], ['Asesora', v.asesora], ['Creada', fecha(v.creada)]]),
        v.estado_pago === 'Sin soporte' && h('div', { clase: 'acciones' }, h('button', { clase: v.valor > 0 ? '' : 'primario', alClick: () => abrirNuevaVenta(v) }, v.valor > 0 ? 'Cambiar cotización' : 'Cotizar')),
        v.enlace && [h('label', null, 'Enlace del formulario para el cliente'),
          h('div', { clase: 'barra' }, h('input', { readonly: true, value: v.enlace, 'aria-label': 'Enlace del formulario', alFocus: (e) => e.target.select() }),
            h('button', { alClick: async (e) => { try { await navigator.clipboard.writeText(v.enlace); e.target.textContent = 'Copiado'; } catch { e.target.textContent = 'Cópialo a mano'; } } }, 'Copiar'))],
        h('label', null, 'Etapa del trámite' + (listo ? '' : ' (se habilita con pago confirmado y registro completo)')), selector),
      h('div', { clase: 'tarjeta' }, h('h2', null, 'Pago ', etiqueta(v.estado_pago, v.estado_pago === 'Confirmado' ? 'ok' : v.estado_pago === 'Rechazado' ? 'mal' : 'alerta')),
        pago ? [campos([['Comparación', etiqueta(pago.comparacion, claseComparacion)], ['Valor del soporte', pesos(pago.valor, pago.moneda)], ['Valor esperado', pesos(pago.valor_esperado, pago.moneda)],
          ['Conversión', pago.tasa ? pesos(pago.valor_venta, pago.moneda_venta) + ' a ' + pesos(pago.tasa) + ' por euro' : ''],
          ['Diferencia', pago.diferencia ? pesos(pago.diferencia, pago.moneda) : ''], ['Fecha', pago.fecha], ['Medio', pago.medio], ['Referencia', pago.referencia],
          ['Paga', pago.pagador], ['Recibe', pago.destino], ['Observaciones', pago.observaciones], ['Recibido', fecha(pago.recibido)]]),
          v.estado_pago !== 'Confirmado' && h('div', { clase: 'acciones' },
            h('button', { clase: 'bien', alClick: () => ejecutar('confirmar_pago', { id: v.id, confirmado: true }, error) }, 'Contabilidad: confirmar pago'),
            h('button', { clase: 'mal', alClick: () => ejecutar('confirmar_pago', { id: v.id, confirmado: false }, error) }, 'Rechazar'))]
          : h('p', { clase: 'suave' }, 'El cliente aún no ha enviado el soporte de pago por WhatsApp.')),
      h('div', { clase: 'tarjeta' }, h('h2', null, 'Registro ', etiqueta(v.estado_registro, v.estado_registro === 'Completo' ? 'ok' : v.estado_registro === 'Faltan documentos' ? 'alerta' : '')),
        registro ? campos([['Nombre', registro.nombre], ['Cédula', registro.cedula], ['Nacimiento', registro.fecha_nacimiento], ['Correo', registro.correo],
          ['Universidad', registro.universidad], ['Título', registro.titulo], ['Fecha de grado', registro.fecha_grado], ['Código de verificación', registro.codigo_verificacion],
          ['Recibidos', registro.documentos_recibidos.join(', ')], ['Faltan', registro.documentos_faltantes.join(', ')],
          ['Legibilidad', registro.legibilidad], ['Diferencias', registro.diferencias],
          ['Lectura automática', registro.lectura && etiqueta(registro.lectura.estado === 'hecha' ? 'Leído con IA' : registro.lectura.estado === 'pendiente' ? 'Leyendo…' : 'Revisar a mano', registro.lectura.estado === 'hecha' ? 'ok' : 'alerta')],
          ['Observaciones de la lectura', registro.lectura && registro.lectura.observaciones],
          ['Archivos del formulario', registro.archivos_formulario && h('span', null, Object.keys(registro.archivos_formulario).map((documento) =>
            h('button', { alClick: () => abrirDocumento(v.id, documento, error) }, 'Ver ' + documento)))]])
          : h('p', { clase: 'suave' }, 'El cliente aún no ha enviado sus documentos.'),
        registro && registro.archivos_formulario && registro.lectura && registro.lectura.estado !== 'hecha' && h('div', { clase: 'acciones' },
          h('button', { alClick: async (e) => { e.target.disabled = true; e.target.textContent = 'Leyendo… (tarda hasta un minuto)'; try { await pedir('/api/leer', { id: v.id }); } catch (fallo) { error.textContent = fallo.message; } } }, 'Leer documentos con IA'))),
      h('div', { clase: 'tarjeta' }, h('h2', null, 'Historial'),
        h('ul', { clase: 'historial' }, [...v.historial].reverse().map((paso) => h('li', null, h('span', { clase: 'suave' }, fecha(paso.fecha) + ' · '), paso.hecho))))),
    error,
    h('div', { clase: 'acciones' }, h('button', { clase: 'mal', alClick: () => { if (confirm('¿Eliminar esta venta de prueba?')) { estado.abierta = null; ejecutar('eliminar', { id: v.id }, error); } } }, 'Eliminar venta')));
}

async function abrirDocumento(id, documento, error) {
  // La ventana se abre antes de pedir la direccion: si se abre despues, el navegador la bloquea.
  const ventana = window.open('about:blank', '_blank');
  try {
    const { direccion } = await pedir('/api/documento', { id, documento });
    if (ventana) ventana.location = direccion; else window.location = direccion;
  } catch (fallo) { if (ventana) ventana.close(); error.textContent = fallo.message; }
}

function abrirNuevaVenta(existente) {
  const error = h('p', { clase: 'error', role: 'alert' });
  const campo = (id, texto, atributos) => [h('label', { for: id }, texto), h('input', { id, ...atributos })];
  const asesora = h('select', { id: 'asesora' }, h('option', { value: '' }, 'Asignar por turno'), estado.asesoras.map((a) => h('option', { value: a }, a)));
  const moneda = h('select', { id: 'moneda' }, h('option', { value: 'COP' }, 'Pesos colombianos (COP)'), h('option', { value: 'EUR' }, 'Euros (EUR)'));
  const dialogo = h('dialog', { clase: 'tarjeta' });
  const formulario = h('form', { alSubmit: async (evento) => {
    evento.preventDefault();
    const valor = (id) => formulario.querySelector('#' + id).value.trim();
    try {
      if (existente) await accion('cotizar', { id: existente.id, servicio: valor('servicio'), valor: valor('valor'), moneda: moneda.value, tasa: valor('tasa') });
      else await accion('crear_venta', { cliente: valor('cliente'), telefono: valor('telefono'), servicio: valor('servicio'), valor: valor('valor'), moneda: moneda.value, tasa: valor('tasa'), asesora: asesora.value });
      dialogo.close(); dialogo.remove(); await cargar();
    } catch (fallo) { error.textContent = fallo.message; }
  } },
    h('h2', null, existente ? 'Cotizar' : 'Nueva venta'),
    !existente && h('p', { clase: 'suave' }, 'El cliente debe escribir a la línea de WhatsApp desde este mismo número.'),
    !existente && campo('telefono', 'WhatsApp del cliente (con indicativo, ej. 573001234567)', { required: true, inputmode: 'tel' }),
    campo('servicio', 'Servicio', { required: true, value: existente && existente.valor > 0 ? existente.servicio : 'Apostilla de título y notas' }),
    h('label', { for: 'tarifa' }, 'Tarifa'),
    h('select', { id: 'tarifa', alChange: (e) => {
      const tarifa = TARIFAS[Number(e.target.value)];
      if (!tarifa) return;
      formulario.querySelector('#servicio').value = tarifa[0];
      formulario.querySelector('#valor').value = tarifa[1];
      moneda.value = 'EUR';
    } }, h('option', { value: '' }, 'Otra (escribir a mano)'), TARIFAS.map(([nombre, valor], i) => h('option', { value: i }, nombre + ' — € ' + valor))),
    h('label', { for: 'moneda' }, 'Moneda de la cotización'), moneda,
    campo('valor', 'Valor de la venta', { required: true, inputmode: 'decimal', placeholder: '1.250.000 o 250' }),
    campo('tasa', 'Tasa de cambio: pesos por euro (obligatoria si cotizas en euros)', { inputmode: 'numeric', placeholder: '4.500' }),
    !existente && campo('cliente', 'Nombre (opcional; se completa con los documentos)', {}),
    !existente && [h('label', { for: 'asesora' }, 'Asesora'), asesora], error,
    h('div', { clase: 'acciones' }, h('button', { clase: 'primario', type: 'submit' }, existente ? 'Guardar cotización' : 'Crear venta'),
      h('button', { type: 'button', alClick: () => { dialogo.close(); dialogo.remove(); } }, 'Cancelar')));
  dialogo.append(formulario);
  document.body.append(dialogo);
  dialogo.showModal();
}

cargar().catch(() => pintarEntrada());
</script>
</body>
</html>`;
