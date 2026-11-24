// Envia al cliente la respuesta que dejo la IA de apoyo comercial, si la hay.
// El agente guarda su mensaje en la variable `respuesta`. En segundo plano Kapso no deja que los
// pasos de envio escriban al cliente (`outbound_disabled`), asi que esta funcion lo envia ella
// misma por la API de WhatsApp con el secreto KAPSO_API_KEY. Sin ese secreto no se envia nada.
// Kapso exige una funcion `handler(request, env)` sin `export`.
const API_DE_WHATSAPP = 'https://api.kapso.ai/meta/whatsapp/v24.0';
const MAXIMO_DE_UN_MENSAJE = 4000;

async function enviar(env, lineaId, telefono, texto) {
  const respuesta = await fetch(`${API_DE_WHATSAPP}/${lineaId}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': env.KAPSO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: telefono, type: 'text', text: { body: texto.slice(0, MAXIMO_DE_UN_MENSAJE) } }),
  });
  return respuesta.ok ? 'enviado' : `rechazado por WhatsApp (${respuesta.status})`;
}

async function handler(request, env) {
  const cuerpo = await request.json().catch(() => ({}));
  const contexto = cuerpo.execution_context || {};
  const esDecision = Array.isArray(cuerpo.available_edges);
  const texto = String(contexto.vars?.respuesta ?? '').trim();
  const telefono = String(contexto.context?.phone_number ?? '').replace(/\D/g, '');
  const lineaId = String(contexto.system?.whatsapp_config?.phone_number_id ?? '');
  let resultado = 'sin respuesta';
  if (texto && esDecision) {
    if (!env.KAPSO_API_KEY) resultado = 'falta el secreto KAPSO_API_KEY';
    else if (!telefono || !lineaId) resultado = 'faltan el telefono o la linea';
    else resultado = await enviar(env, lineaId, telefono, texto).catch(() => 'error de red');
  }
  const salida = esDecision ? { next_edge: 'callar', vars: { envio: resultado } } : { ok: true };
  return new Response(JSON.stringify(salida), { headers: { 'Content-Type': 'application/json' } });
}
