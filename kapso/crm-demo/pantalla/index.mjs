// Pantalla del sistema demo de apostillas. Corre en AWS Lambda con una direccion publica propia.
// Muestra la pagina, valida el usuario y reenvia cada accion a la funcion publica de Kapso
// (`crm-demo-panel`), que es donde estan los datos. El navegador nunca ve la clave de Kapso.
//
// Variables: USUARIO, CLAVE_HASH ("sal:hash" en hexadecimal, scrypt), SECRETO_SESION, KAPSO_URL, KAPSO_CLAVE.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PAGINA } from './pagina.mjs';

const HORAS_DE_SESION = 12;
const MAXIMO_INTENTOS = 5;
const MINUTOS_DE_BLOQUEO = 15;
const MAXIMO_CUERPO = 20_000;
const ACCIONES = new Set(['listar', 'ver', 'crear_venta', 'confirmar_pago', 'cambiar_etapa', 'eliminar']);
const COOKIE = 'sesion_demo';

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

async function reenviar(datos, env) {
  if (!ACCIONES.has(datos.accion)) return responder(400, { ok: false, error: 'Acción desconocida' });
  try {
    const respuesta = await fetch(env.KAPSO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Token': env.KAPSO_CLAVE },
      body: JSON.stringify(datos),
      signal: AbortSignal.timeout(20_000),
    });
    const cuerpo = await respuesta.json().catch(() => null);
    if (!respuesta.ok || !cuerpo) {
      console.error('El sistema respondio mal', respuesta.status);
      return responder(502, { ok: false, error: 'El sistema no respondió. Intenta de nuevo.' });
    }
    return responder(200, cuerpo);
  } catch (error) {
    console.error('No se pudo llamar al sistema', error instanceof Error ? error.message : error);
    return responder(502, { ok: false, error: 'El sistema no respondió. Intenta de nuevo.' });
  }
}

function pagina() {
  const nonce = randomBytes(16).toString('base64');
  const politica = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return responder(200, PAGINA.replaceAll('__NONCE__', nonce), { 'Content-Security-Policy': politica });
}

export async function atender(evento, env, ahora = Date.now()) {
  const metodo = evento.requestContext?.http?.method || 'GET';
  const ruta = evento.rawPath || '/';
  if (metodo === 'GET' && ruta === '/') return pagina();
  if (metodo !== 'POST') return responder(404, { ok: false, error: 'No existe' });
  // Las acciones solo se aceptan desde la propia pagina: JSON y un encabezado que un formulario ajeno no puede enviar.
  const encabezados = evento.headers || {};
  if (!String(encabezados['content-type'] || '').startsWith('application/json') || encabezados['x-demo'] !== '1') {
    return responder(400, { ok: false, error: 'Solicitud no válida' });
  }
  const datos = leerCuerpo(evento);
  if (!datos) return responder(400, { ok: false, error: 'Solicitud no válida' });
  if (ruta === '/api/entrar') return entrar(datos, env, ahora);
  if (!sesionValida(leerCookie(evento), env.SECRETO_SESION, ahora)) return responder(401, { ok: false, error: 'Sesión vencida' });
  if (ruta === '/api/salir') return responder(200, { ok: true }, {}, [`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`]);
  if (ruta === '/api/accion') return reenviar(datos, env);
  return responder(404, { ok: false, error: 'No existe' });
}

export const handler = (evento) => atender(evento, process.env);
