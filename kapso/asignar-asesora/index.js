/*
 * Reparto de conversaciones de WhatsApp entre asesoras (funcion de Kapso, Cloudflare Workers).
 *
 * La llama una automatizacion cada vez que se abre una conversacion. Decide a quien le toca,
 * la asigna en la bandeja y, si es fuera de horario, le avisa al cliente.
 *
 * Reglas:
 *  - Lunes a viernes: por turnos entre las titulares.
 *  - El cliente conserva a su asesora: si ya lo atendio una titular, vuelve a ella.
 *  - Sabados, o cuando la titular que corresponde esta ausente: va a la asesora de reemplazo.
 *  - Fuera de horario se asigna igual (queda en la cola de quien corresponde) y se avisa al cliente.
 *
 * Kapso llama a handler(request, env); aqui no se usa "export default".
 */

const CONFIG = {
  zonaHoraria: 'America/Bogota',
  // Se buscan entre los miembros del proyecto por nombre (sin tildes ni mayusculas).
  titulares: ['Estefania Diaz', 'Melissa Orellano'],
  reemplazo: 'Andrea Martinez',
  // Dia de la semana (1 = lunes ... 7 = domingo) -> [apertura, cierre]. Un dia sin horario esta cerrado.
  horario: { 1: ['08:00', '18:00'], 2: ['08:00', '18:00'], 3: ['08:00', '18:00'], 4: ['08:00', '18:00'], 5: ['08:00', '18:00'], 6: ['08:00', '13:00'] },
  diaDelReemplazo: 6,
  mensajeFueraDeHorario:
    'Gracias por escribirnos. En este momento estamos fuera de nuestro horario de atención. Tu mensaje quedó registrado y una asesora te responderá en cuanto abramos.',
};

const API = 'https://api.kapso.ai/platform/v1';
const META = 'https://api.kapso.ai/meta/whatsapp/v24.0';
const MINUTOS_CACHE_EQUIPO = 10;
const DIAS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function sinTildes(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Dia de la semana y hora local, sin depender del reloj del servidor. */
function momentoLocal(fecha, zonaHoraria) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: zonaHoraria, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(fecha);
  const valor = (tipo) => partes.find((parte) => parte.type === tipo).value;
  return { dia: DIAS[valor('weekday')], hora: `${valor('hour') === '24' ? '00' : valor('hour')}:${valor('minute')}` };
}

function estaAbierto(momento, horario) {
  const turno = horario[momento.dia];
  return Boolean(turno) && momento.hora >= turno[0] && momento.hora < turno[1];
}

/**
 * Decide quien atiende. No toca nada: recibe el estado y devuelve la decision.
 * estado = { duena: nombre de la titular que ya atendio a este cliente (o null), turno: numero,
 *            ausentes: [nombres] }
 */
function elegirAsesora(config, momento, estado) {
  const ausentes = (estado.ausentes || []).map(sinTildes);
  const disponible = (nombre) => Boolean(nombre) && !ausentes.includes(sinTildes(nombre));
  const titulares = config.titulares.filter(disponible);
  const reemplazo = disponible(config.reemplazo) ? config.reemplazo : null;
  const abierto = estaAbierto(momento, config.horario);
  const base = { abierto, turno: estado.turno || 0, duena: estado.duena || null };

  if (momento.dia === config.diaDelReemplazo && reemplazo) {
    return { ...base, asesora: reemplazo, motivo: 'Los sábados atiende la asesora de reemplazo' };
  }
  if (estado.duena) {
    if (disponible(estado.duena)) return { ...base, asesora: estado.duena, motivo: 'Cliente que ya atendía esta asesora' };
    if (reemplazo) return { ...base, asesora: reemplazo, motivo: `Su asesora (${estado.duena}) está ausente` };
  }
  if (titulares.length === 0) {
    return reemplazo
      ? { ...base, asesora: reemplazo, motivo: 'Las titulares están ausentes' }
      : { ...base, asesora: null, motivo: 'No hay ninguna asesora disponible' };
  }
  // El turno avanza sobre la lista completa para que una ausencia no desordene el reparto al volver.
  const total = config.titulares.length;
  for (let paso = 0; paso < total; paso += 1) {
    const candidata = config.titulares[(base.turno + paso) % total];
    if (disponible(candidata)) {
      return { ...base, asesora: candidata, turno: (base.turno + paso + 1) % total, duena: candidata, motivo: 'Cliente nuevo: reparto por turnos' };
    }
  }
  return { ...base, asesora: null, motivo: 'No hay ninguna asesora disponible' };
}

function json(cuerpo, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
}

async function kapso(env, metodo, url, cuerpo) {
  const respuesta = await fetch(url, {
    method: metodo,
    headers: { 'X-API-Key': env.KAPSO_API_KEY, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new Error(`Kapso respondio ${respuesta.status} en ${metodo} ${url.replace(/^https:\/\/[^/]+/, '')}`);
  return datos;
}

/** Miembros del proyecto, con cache corta para no consultarlos en cada conversacion. */
async function equipo(env) {
  const guardado = await env.KV.get('reparto:equipo', { type: 'json' });
  if (guardado) return guardado;
  const usuarios = ((await kapso(env, 'GET', `${API}/users`)) || {}).data || [];
  // Para asignar, Kapso espera el `user_id` de la persona, no el `id` de su membresia en el proyecto.
  const lista = usuarios.map((usuario) => ({ id: usuario.user_id || usuario.id, nombre: usuario.name || '' }));
  await env.KV.put('reparto:equipo', JSON.stringify(lista), { expirationTtl: MINUTOS_CACHE_EQUIPO * 60 });
  return lista;
}

function buscarMiembro(lista, nombre) {
  const buscado = sinTildes(nombre);
  return lista.find((miembro) => sinTildes(miembro.nombre) === buscado) || lista.find((miembro) => sinTildes(miembro.nombre).startsWith(buscado.split(' ')[0])) || null;
}

async function leerEstado(env, contacto) {
  const [turno, ausentes, duena] = await Promise.all([
    env.KV.get('reparto:turno'),
    env.KV.get('reparto:ausentes', { type: 'json' }),
    contacto ? env.KV.get(`reparto:contacto:${contacto}`) : null,
  ]);
  return { turno: Number(turno) || 0, ausentes: ausentes || [], duena: duena || null };
}

/** Lo que Kapso envia cambia segun como se dispare la automatizacion; se busca en los lugares conocidos. */
function leerConversacion(cuerpo) {
  const sistema = ((cuerpo.execution_context || {}).system || {});
  const evento = (sistema.event || {}).conversation || {};
  const contexto = (cuerpo.execution_context || {}).context || {};
  const whatsapp = (cuerpo.whatsapp_context || {}).conversation || {};
  return {
    id: cuerpo.conversation_id || evento.id || whatsapp.id || contexto.conversation_id || null,
    contacto: String(cuerpo.contacto || evento.phone_number || whatsapp.phone_number || contexto.phone_number || '').replace(/\D/g, '') || null,
    linea: cuerpo.phone_number_id || evento.phone_number_id || whatsapp.phone_number_id || contexto.phone_number_id || null,
  };
}

async function asignar(env, conversacion, decision) {
  const miembro = decision.asesora ? buscarMiembro(await equipo(env), decision.asesora) : null;
  if (!miembro) return { asignada: false, detalle: decision.asesora ? `${decision.asesora} aún no es miembro del proyecto en Kapso` : decision.motivo };
  const actuales = ((await kapso(env, 'GET', `${API}/whatsapp/conversations/${conversacion.id}/assignments`)) || {}).data || [];
  if (actuales.some((asignacion) => asignacion.active === true)) {
    return { asignada: false, detalle: 'La conversación ya tenía una asesora asignada' };
  }
  await kapso(env, 'POST', `${API}/whatsapp/conversations/${conversacion.id}/assignments`, { assignment: { user_id: miembro.id, notes: `Reparto automático: ${decision.motivo}` } });
  return { asignada: true, detalle: miembro.nombre };
}

async function avisarFueraDeHorario(env, conversacion) {
  if (!conversacion.linea || !conversacion.contacto) return false;
  await kapso(env, 'POST', `${META}/${conversacion.linea}/messages`, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: conversacion.contacto, type: 'text', text: { body: CONFIG.mensajeFueraDeHorario },
  });
  return true;
}

async function handler(request, env) {
  const cuerpo = await request.json().catch(() => ({}));
  const ahora = cuerpo.ahora ? new Date(cuerpo.ahora) : new Date();
  const momento = momentoLocal(ahora, CONFIG.zonaHoraria);

  // Marcar o quitar una ausencia: { accion: "ausencia", asesora: "Melissa Orellano", ausente: true }
  if (cuerpo.accion === 'ausencia') {
    const estado = await leerEstado(env, null);
    const nombre = sinTildes(cuerpo.asesora);
    const conocida = [...CONFIG.titulares, CONFIG.reemplazo].find((asesora) => sinTildes(asesora) === nombre || sinTildes(asesora).startsWith(nombre));
    if (!nombre || !conocida) return json({ ok: false, error: 'No conozco a esa asesora' }, 400);
    const ausentes = estado.ausentes.filter((asesora) => sinTildes(asesora) !== sinTildes(conocida));
    if (cuerpo.ausente) ausentes.push(conocida);
    await env.KV.put('reparto:ausentes', JSON.stringify(ausentes));
    return json({ ok: true, ausentes });
  }

  const conversacion = leerConversacion(cuerpo);
  const estado = await leerEstado(env, conversacion.contacto);
  const decision = elegirAsesora(CONFIG, momento, estado);

  // Ensayo o consulta: dice que haria, sin asignar, sin avanzar el turno y sin escribirle a nadie.
  if (cuerpo.accion === 'simular' || cuerpo.accion === 'estado') {
    return json({ ok: true, ensayo: true, momento, estado, decision, configurada: Boolean(env.KAPSO_API_KEY) });
  }

  if (!conversacion.id) return json({ ok: false, error: 'No llegó la conversación', vars: { reparto_error: 'sin conversacion' } });
  if (!env.KAPSO_API_KEY) return json({ ok: false, error: 'Falta el secreto KAPSO_API_KEY', vars: { reparto_error: 'sin llave' } });

  try {
    const resultado = await asignar(env, conversacion, decision);
    if (resultado.asignada) {
      await env.KV.put('reparto:turno', String(decision.turno));
      if (decision.duena && conversacion.contacto) await env.KV.put(`reparto:contacto:${conversacion.contacto}`, decision.duena);
    }
    const avisado = !decision.abierto && resultado.asignada ? await avisarFueraDeHorario(env, conversacion).catch(() => false) : false;
    return json({ ok: true, vars: { reparto_asesora: resultado.asignada ? resultado.detalle : '', reparto_motivo: resultado.asignada ? decision.motivo : resultado.detalle, reparto_fuera_de_horario: !decision.abierto, reparto_aviso_enviado: avisado } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'error', vars: { reparto_error: 'fallo al asignar' } });
  }
}
