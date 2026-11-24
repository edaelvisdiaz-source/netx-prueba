// Pantalla del sistema demo de apostillas. Corre en AWS Lambda con una direccion publica propia.
// Muestra la pagina, valida el usuario y reenvia cada accion a la funcion publica de Kapso
// (`crm-demo-panel`), que es donde estan los datos. El navegador nunca ve la clave de Kapso.
//
// Ademas sirve el formulario publico de cada venta (/f/<codigo>): el cliente escribe su correo y sube
// sus tres documentos a un almacenamiento privado.
//
// Variables: DOCUMENTOS_BUCKET, USUARIO, CLAVE_HASH ("sal:hash" en hexadecimal, scrypt), SECRETO_SESION, KAPSO_URL, KAPSO_CLAVE.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PAGINA } from './pagina.mjs';
import { FORMULARIO } from './formulario.mjs';
import { leerDocumentos } from './lectura.mjs';

const HORAS_DE_SESION = 12;
const MAXIMO_INTENTOS = 5;
const MINUTOS_DE_BLOQUEO = 15;
const MAXIMO_CUERPO = 20_000;
const ACCIONES = new Set(['listar', 'ver', 'crear_venta', 'cotizar', 'confirmar_pago', 'registrar_pago', 'editar_registro', 'cambiar_etapa', 'eliminar']);
const COOKIE = 'sesion_demo';
const DOCUMENTOS = ['cedula', 'titulo', 'notas'];
const TIPOS = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAXIMO_ARCHIVO = 15 * 1024 * 1024;
const RUTA_FORMULARIO = /^\/f\/[0-9a-f]{24}$/;

// Solo protege a esta copia del programa; para una demo de un usuario es suficiente.
const intentos = { fallos: 0, bloqueadoHasta: 0 };

function responder(estado, cuerpo, encabezados = {}, cookies = []) {
  const esTexto = typeof cuerpo === 'string';
  return {
    statusCode: estado,
    headers: {
      'Content-Type': esTexto ? 'text/html; charset=utf-8' : 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Strict-Transport-Security': 'max-age=31536000',
      ...encabezados,
    },
    cookies,
    body: esTexto ? cuerpo : JSON.stringify(cuerpo),
  };
}

function iguales(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function claveCorrecta(clave, guardada) {
  const [sal, hash] = String(guardada).split(':');
  if (!sal || !hash) return false;
  return iguales(scryptSync(String(clave), Buffer.from(sal, 'hex'), 32).toString('hex'), hash);
}

function firmar(texto, secreto) {
  return createHmac('sha256', secreto).update(texto).digest('hex');
}

export function crearSesion(secreto, ahora) {
  const vence = String(ahora + HORAS_DE_SESION * 3_600_000);
  return `${vence}.${firmar(vence, secreto)}`;
}

export function sesionValida(valor, secreto, ahora) {
  const [vence, firma] = String(valor || '').split('.');
  return Boolean(vence && firma) && iguales(firma, firmar(vence, secreto)) && Number(vence) > ahora;
}

function leerCookie(evento) {
  const todas = evento.cookies || [];
  const encontrada = todas.find((cookie) => cookie.startsWith(`${COOKIE}=`));
  return encontrada ? encontrada.slice(COOKIE.length + 1) : '';
}

function leerCuerpo(evento) {
  const crudo = evento.isBase64Encoded ? Buffer.from(evento.body || '', 'base64').toString('utf8') : evento.body || '';
  if (crudo.length > MAXIMO_CUERPO) return null;
  try {
    const datos = JSON.parse(crudo || '{}');
    return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : null;
  } catch {
    return null;
  }
}

function entrar(datos, env, ahora) {
  if (ahora < intentos.bloqueadoHasta) return responder(429, { ok: false, error: 'Demasiados intentos. Espera unos minutos.' });
  const correcto = iguales(String(datos.usuario || ''), env.USUARIO) && claveCorrecta(datos.clave || '', env.CLAVE_HASH);
  if (!correcto) {
    intentos.fallos += 1;
    if (intentos.fallos >= MAXIMO_INTENTOS) {
      intentos.bloqueadoHasta = ahora + MINUTOS_DE_BLOQUEO * 60_000;
      intentos.fallos = 0;
    }
    return responder(401, { ok: false, error: 'Usuario o contraseña incorrectos' });
  }
  intentos.fallos = 0;
  const cookie = `${COOKIE}=${crearSesion(env.SECRETO_SESION, ahora)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${HORAS_DE_SESION * 3600}`;
  return responder(200, { ok: true }, {}, [cookie]);
}

async function sistema(datos, env) {
  const respuesta = await fetch(env.KAPSO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Token': env.KAPSO_CLAVE },
    body: JSON.stringify(datos),
    signal: AbortSignal.timeout(20_000),
  });
  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !cuerpo) throw new Error(`El sistema respondio ${respuesta.status}`);
  return cuerpo;
}

/** Llama al sistema y convierte cualquier fallo en una respuesta clara, sin detalles internos. */
async function conSistema(tarea) {
  try {
    return await tarea();
  } catch (error) {
    console.error('Fallo una accion', error instanceof Error ? error.message : error);
    return responder(502, { ok: false, error: 'El sistema no respondió. Intenta de nuevo.' });
  }
}

async function prepararSubida(datos, env, almacen) {
  const extension = TIPOS[datos.tipo];
  if (!DOCUMENTOS.includes(datos.documento)) return responder(400, { ok: false, error: 'Documento desconocido' });
  if (!extension) return responder(400, { ok: false, error: 'Solo se aceptan archivos PDF, JPG o PNG' });
  if (!(Number(datos.tamano) > 0) || Number(datos.tamano) > MAXIMO_ARCHIVO) return responder(400, { ok: false, error: 'El archivo debe pesar menos de 15 MB' });
  const venta = await sistema({ accion: 'formulario_ver', codigo: datos.codigo }, env);
  if (!venta.ok) return responder(200, venta);
  const ruta = `ventas/${venta.id}/${datos.documento}-${randomBytes(8).toString('hex')}.${extension}`;
  return responder(200, { ok: true, ruta, direccion: await almacen.direccionParaSubir(ruta, datos.tipo) });
}

async function enviarFormulario(datos, env, almacen, despachar) {
  const venta = await sistema({ accion: 'formulario_ver', codigo: datos.codigo }, env);
  if (!venta.ok) return responder(200, venta);
  const archivos = {};
  for (const documento of DOCUMENTOS) {
    const ruta = String(datos.archivos?.[documento] || '');
    // Solo se aceptan archivos que este programa autorizo para esta venta y que de verdad llegaron.
    if (!ruta.startsWith(`ventas/${venta.id}/${documento}-`)) return responder(200, { ok: false, error: 'Faltan documentos por subir' });
    const tamano = await almacen.tamano(ruta);
    if (tamano === null || tamano === 0) return responder(200, { ok: false, error: 'Un documento no terminó de subir. Vuelve a adjuntarlo.' });
    if (tamano > MAXIMO_ARCHIVO) return responder(200, { ok: false, error: 'Un documento pesa más de 15 MB' });
    archivos[documento] = ruta;
  }
  const resultado = await sistema({ accion: 'formulario_enviar', codigo: datos.codigo, correo: datos.correo, acepta: datos.acepta === true, archivos }, env);
  if (!resultado.ok) return responder(200, resultado);
  // La lectura con IA va aparte: si no arranca, el registro ya quedo guardado y la asesora lo revisa.
  await despachar({ tarea: 'leer', id: venta.id }).catch((error) => console.error('No arranco la lectura', error instanceof Error ? error.message : error));
  return responder(200, { ok: true });
}

/** Tarea en segundo plano: lee los documentos del formulario y guarda los datos en el sistema. */
export async function tareaDeLectura(id, env, { almacen, conversar }) {
  const { venta } = await sistema({ accion: 'ver', id }, env);
  const archivos = venta?.registro?.archivos_formulario;
  if (!archivos) return { ok: false, error: 'La venta no tiene documentos del formulario' };
  let datos;
  try {
    datos = await leerDocumentos(archivos, { leer: almacen.leer, conversar });
  } catch (error) {
    console.error('Fallo la lectura', error instanceof Error ? `${error.name}: ${error.message}` : error);
    datos = { lectura: { estado: 'fallida', observaciones: 'No se pudo leer automáticamente; revisar a mano' } };
  }
  return sistema({ accion: 'guardar_lectura', id, ...datos }, env);
}

async function verDocumento(datos, env, almacen) {
  const respuesta = await sistema({ accion: 'ver', id: datos.id }, env);
  const ruta = respuesta.venta?.registro?.archivos_formulario?.[datos.documento];
  if (!ruta) return responder(200, { ok: false, error: 'Ese documento no está en el sistema' });
  return responder(200, { ok: true, direccion: await almacen.direccionParaVer(ruta) });
}

async function reenviar(datos, env) {
  if (!ACCIONES.has(datos.accion)) return responder(400, { ok: false, error: 'Acción desconocida' });
  return conSistema(async () => responder(200, await sistema(datos, env)));
}

function pagina(plantilla, origenesExtra = '') {
  const nonce = randomBytes(16).toString('base64');
  const politica = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'${origenesExtra}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return responder(200, plantilla.replaceAll('__NONCE__', nonce), { 'Content-Security-Policy': politica });
}

export async function atender(evento, env, ahora = Date.now(), almacen = null, despachar = async () => undefined) {
  const metodo = evento.requestContext?.http?.method || 'GET';
  const ruta = evento.rawPath || '/';
  if (metodo === 'GET' && ruta === '/') return pagina(PAGINA);
  if (metodo === 'GET' && RUTA_FORMULARIO.test(ruta)) return pagina(FORMULARIO, ` https://${env.DOCUMENTOS_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`);
  if (metodo !== 'POST') return responder(404, { ok: false, error: 'No existe' });
  // Las acciones solo se aceptan desde la propia pagina: JSON y un encabezado que un formulario ajeno no puede enviar.
  const encabezados = evento.headers || {};
  if (!String(encabezados['content-type'] || '').startsWith('application/json') || encabezados['x-demo'] !== '1') {
    return responder(400, { ok: false, error: 'Solicitud no válida' });
  }
  const datos = leerCuerpo(evento);
  if (!datos) return responder(400, { ok: false, error: 'Solicitud no válida' });
  if (ruta === '/api/entrar') return entrar(datos, env, ahora);
  // El formulario es publico: lo protege el codigo del enlace, que solo conoce el cliente.
  if (ruta === '/api/formulario/ver') return conSistema(async () => { const v = await sistema({ accion: 'formulario_ver', codigo: datos.codigo }, env); return responder(200, v.ok ? { ok: true, servicio: v.servicio, enviado: v.enviado } : v); });
  if (ruta === '/api/formulario/subir') return conSistema(() => prepararSubida(datos, env, almacen));
  if (ruta === '/api/formulario/enviar') return conSistema(() => enviarFormulario(datos, env, almacen, despachar));
  if (!sesionValida(leerCookie(evento), env.SECRETO_SESION, ahora)) return responder(401, { ok: false, error: 'Sesión vencida' });
  if (ruta === '/api/salir') return responder(200, { ok: true }, {}, [`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`]);
  if (ruta === '/api/accion') return reenviar(datos, env);
  if (ruta === '/api/documento') return conSistema(() => verDocumento(datos, env, almacen));
  // Repetir la lectura automatica de una venta, por ejemplo si fallo la primera vez.
  if (ruta === '/api/leer') return conSistema(async () => { await despachar({ tarea: 'leer', id: String(datos.id || '') }); return responder(200, { ok: true }); });
  return responder(404, { ok: false, error: 'No existe' });
}

// El deposito de documentos de la demo; se puede cambiar con la variable DOCUMENTOS_BUCKET.
const DEPOSITO = 'apostillas-demo-documentos-146736797821';
let almacenReal = null;
export const handler = async (evento) => {
  const env = { ...process.env, DOCUMENTOS_BUCKET: process.env.DOCUMENTOS_BUCKET || DEPOSITO };
  if (!almacenReal) almacenReal = (await import('./almacen.mjs')).crearAlmacen(env.DOCUMENTOS_BUCKET);
  const servicios = await import('./servicios.mjs');
  // Las tareas en segundo plano llegan sin forma de solicitud web: solo este programa puede lanzarlas.
  if (evento.tarea === 'leer' && !evento.requestContext) return tareaDeLectura(String(evento.id), env, { almacen: almacenReal, conversar: servicios.conversar });
  return atender(evento, env, Date.now(), almacenReal, servicios.despachar);
};
