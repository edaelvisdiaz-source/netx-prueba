/*
 * Registro de clientes por WhatsApp (funcion de Kapso, Cloudflare Workers).
 *
 * Por ahora solo comprueba que estan guardadas las llaves que necesita, sin mostrarlas:
 *   ANTHROPIC_API_KEY  para leer con IA los documentos y soportes de pago
 *   KAPSO_API_KEY      para descargar los archivos y responderle al cliente
 * La lectura de documentos se agrega encima de esta base.
 */

async function probarAnthropic(llave) {
  // Pide la lista de modelos: confirma que la llave sirve sin gastar nada.
  const respuesta = await fetch('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': llave, 'anthropic-version': '2023-06-01' },
  });
  return respuesta.status;
}

async function handler(request, env) {
  const cuerpo = await request.json().catch(() => ({}));
  const estado = { anthropic: Boolean(env.ANTHROPIC_API_KEY), kapso: Boolean(env.KAPSO_API_KEY) };
  if (cuerpo.accion === 'probar' && estado.anthropic) {
    estado.anthropicResponde = await probarAnthropic(env.ANTHROPIC_API_KEY).catch(() => 0);
  }
  return new Response(JSON.stringify({ ok: true, llaves: estado }), { headers: { 'Content-Type': 'application/json' } });
}
