// Envia al cliente la respuesta que dejo la IA de apoyo comercial, si la hay.
// El agente guarda su mensaje en la variable `respuesta`. En segundo plano Kapso no deja que los
// pasos de envio escriban al cliente (`outbound_disabled`), asi que esta funcion lo envia ella
// misma por la API de WhatsApp con el secreto KAPSO_API_KEY. Sin ese secreto no se envia nada.
// Kapso exige una funcion `handler(request, env)` sin `export`.
const API_DE_WHATSAPP = 'https://api.kapso.ai/meta/whatsapp/v24.0';
const API_DE_KAPSO = 'https://api.kapso.ai/platform/v1';
const MAXIMO_DE_UN_MENSAJE = 4000;
// Identificador en WhatsApp de la imagen de tarifas; se fija con la accion `fijar_tarifa`.
const CLAVE_DE_LA_TARIFA = 'apoyo:tarifa_media_id';

async function mensaje(env, lineaId, telefono, contenido) {
  const respuesta = await fetch(`${API_DE_WHATSAPP}/${lineaId}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': env.KAPSO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: telefono, ...contenido }),
  });
  return respuesta.ok ? 'enviado' : `rechazado por WhatsApp (${respuesta.status})`;
}

async function enviar(env, lineaId, telefono, texto, conTarifa) {
  const imagen = conTarifa ? await env.KV.get(CLAVE_DE_LA_TARIFA) : null;
  // La imagen va primero para que el texto quede debajo, como lo haria una asesora.
  const deLaImagen = imagen ? await mensaje(env, lineaId, telefono, { type: 'image', image: { id: imagen } }) : null;
  const delTexto = await mensaje(env, lineaId, telefono, { type: 'text', text: { body: texto.slice(0, MAXIMO_DE_UN_MENSAJE) } });
  if (conTarifa && !imagen) return `${delTexto}; sin imagen de tarifa configurada`;
  return deLaImagen && deLaImagen !== 'enviado' ? `${delTexto}; imagen ${deLaImagen}` : delTexto;
}

/**
 * Cuando el cliente escribe varios mensajes seguidos, cada uno lanza a la IA por separado. Solo
 * debe responder la ejecucion del mensaje mas reciente, que es la que ve todo lo que llego; las
 * anteriores callan. Si no se puede consultar, se responde igual: es peor dejar al cliente sin respuesta.
 */
async function llegoOtroMensajeDespues(env, evento) {
  const conversacion = evento?.conversation?.id;
  const disparador = evento?.message?.whatsapp_message_id;
  if (!conversacion || !disparador) return false;
  try {
    const respuesta = await fetch(`${API_DE_KAPSO}/whatsapp/messages?conversation_id=${encodeURIComponent(conversacion)}&per_page=10`, { headers: { 'X-API-Key': env.KAPSO_API_KEY } });
    if (!respuesta.ok) return false;
    const mensajes = (await respuesta.json()).data || [];
    const ultimoDelCliente = mensajes.find((mensaje) => mensaje.kapso?.direction === 'inbound');
    return Boolean(ultimoDelCliente) && ultimoDelCliente.id !== disparador;
  } catch {
    return false;
  }
}

async function handler(request, env) {
  const cuerpo = await request.json().catch(() => ({}));
  const contexto = cuerpo.execution_context || {};
  const esDecision = Array.isArray(cuerpo.available_edges);
  // Mantenimiento con la llave de Kapso: fija la imagen de tarifas que se envia a los clientes.
  if (!esDecision && cuerpo.accion === 'fijar_tarifa' && /^\w{5,60}$/.test(String(cuerpo.media_id || ''))) {
    await env.KV.put(CLAVE_DE_LA_TARIFA, String(cuerpo.media_id));
    return new Response(JSON.stringify({ ok: true, tarifa: 'fijada' }), { headers: { 'Content-Type': 'application/json' } });
  }
  const texto = String(contexto.vars?.respuesta ?? '').trim();
  const telefono = String(contexto.context?.phone_number ?? '').replace(/\D/g, '');
  const lineaId = String(contexto.system?.whatsapp_config?.phone_number_id ?? '');
  let resultado = 'sin respuesta';
  if (texto && esDecision) {
    if (!env.KAPSO_API_KEY) resultado = 'falta el secreto KAPSO_API_KEY';
    else if (!telefono || !lineaId) resultado = 'faltan el telefono o la linea';
    else if (await llegoOtroMensajeDespues(env, contexto.system?.event)) resultado = 'omitido: el cliente escribio despues; responde la ejecucion de ese mensaje';
    else resultado = await enviar(env, lineaId, telefono, texto, /^s[ií]/i.test(String(contexto.vars?.enviar_tarifa ?? ''))).catch(() => 'error de red');
  }
  const salida = esDecision ? { next_edge: 'callar', vars: { envio: resultado } } : { ok: true };
  return new Response(JSON.stringify(salida), { headers: { 'Content-Type': 'application/json' } });
}
