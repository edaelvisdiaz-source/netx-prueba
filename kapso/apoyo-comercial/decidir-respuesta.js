// Decide si la automatizacion de apoyo comercial le escribe al cliente.
// El agente deja su mensaje en la variable `respuesta`; si esta vacia, no se envia nada.
// Kapso exige una funcion `handler(request, env)` sin `export`.
async function handler(request) {
  const cuerpo = await request.json().catch(() => ({}));
  const respuesta = String(cuerpo.execution_context?.vars?.respuesta ?? '').trim();
  const salida = Array.isArray(cuerpo.available_edges) ? { next_edge: respuesta ? 'enviar' : 'callar' } : { ok: true };
  return new Response(JSON.stringify(salida), { headers: { 'Content-Type': 'application/json' } });
}
