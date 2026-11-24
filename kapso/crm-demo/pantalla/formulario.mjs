// Formulario publico de registro de una venta (/f/<codigo>). Pide solo lo que no sale de los
// documentos: el correo, los tres archivos y la aceptacion de terminos.
export const FORMULARIO = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Registro de documentos · Apostillas y Legalizaciones</title>
<style nonce="__NONCE__">
:root{--texto:#1c2430;--suave:#5b6675;--borde:#dfe3e8;--marca:#1f5fbf;--ok:#1a7f4b;--mal:#b3261e}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:var(--texto)}
header{background:#14213d;color:#fff;padding:16px}
header h1{font-size:18px;margin:0}
header p{margin:2px 0 0;opacity:.8;font-size:14px}
main{max-width:560px;margin:0 auto;padding:16px}
.tarjeta{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:18px;margin-bottom:14px}
h2{font-size:17px;margin:0 0 6px}
label{display:block;font-weight:600;margin:16px 0 4px}
.ayuda{color:var(--suave);font-size:14px;margin:0 0 6px}
input[type=email]{font:inherit;width:100%;padding:11px;border:1px solid var(--borde);border-radius:8px;min-height:46px}
.archivo{border:1px dashed #b8c0cc;border-radius:10px;padding:12px;margin-top:10px}
.archivo.listo{border-style:solid;border-color:var(--ok);background:#f1faf4}
.archivo.fallo{border-style:solid;border-color:var(--mal)}
.archivo input{font:inherit;width:100%;margin-top:6px}
.estado{font-size:14px;margin-top:6px;min-height:20px;color:var(--suave)}
.archivo.listo .estado{color:var(--ok)}
.archivo.fallo .estado{color:var(--mal)}
.acepto{display:flex;gap:10px;align-items:flex-start;margin-top:18px;font-weight:400}
.acepto input{width:22px;height:22px;margin-top:2px;flex:none}
button{font:inherit;width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:var(--marca);color:#fff;font-weight:600;min-height:50px;cursor:pointer}
button:disabled{opacity:.55;cursor:default}
.error{color:var(--mal);min-height:22px;margin:10px 0 0}
.bien{color:var(--ok);font-size:40px;margin:0}
</style>
</head>
<body>
<header><h1>Apostillas y Legalizaciones</h1><p>Registro de documentos</p></header>
<main id="raiz"><div class="tarjeta"><p>Cargando…</p></div></main>
<script nonce="__NONCE__">
'use strict';
const codigo = location.pathname.split('/').pop();
const raiz = document.getElementById('raiz');
const DOCUMENTOS = [
  ['cedula', 'Cédula o pasaporte', 'Por ambas caras, en un solo archivo.'],
  ['titulo', 'Diploma o certificación supletoria', 'El documento que expide la universidad.'],
  ['notas', 'Certificado académico de notas', 'Con todas sus páginas.'],
];
const TIPOS = ['application/pdf', 'image/jpeg', 'image/png'];
const MAXIMO = 15 * 1024 * 1024;
const subidos = {};

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
  const respuesta = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo': '1' }, body: JSON.stringify({ codigo, ...datos }) });
  const cuerpo = await respuesta.json().catch(() => ({ ok: false, error: 'No pudimos conectar. Intenta de nuevo.' }));
  if (!cuerpo.ok) throw new Error(cuerpo.error || 'No se pudo completar. Intenta de nuevo.');
  return cuerpo;
}

function mensaje(titulo, texto, bien) {
  raiz.replaceChildren(h('div', { clase: 'tarjeta' }, bien && h('p', { clase: 'bien', 'aria-hidden': 'true' }, '✓'), h('h2', null, titulo), h('p', null, texto)));
}

function campoArchivo([clave, titulo, ayuda], alCambiar) {
  const estado = h('div', { clase: 'estado', role: 'status' }, 'PDF, JPG o PNG. Máximo 15 MB.');
  const caja = h('div', { clase: 'archivo' });
  const entrada = h('input', { type: 'file', id: clave, accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', alChange: async () => {
    const archivo = entrada.files[0];
    delete subidos[clave]; caja.className = 'archivo'; alCambiar();
    if (!archivo) return;
    const fallo = (texto) => { caja.className = 'archivo fallo'; estado.textContent = texto; };
    if (!TIPOS.includes(archivo.type)) return fallo('Ese tipo de archivo no sirve. Usa PDF, JPG o PNG.');
    if (archivo.size > MAXIMO) return fallo('El archivo pesa más de 15 MB. Envía una versión más liviana.');
    estado.textContent = 'Subiendo…';
    try {
      const { ruta, direccion } = await pedir('/api/formulario/subir', { documento: clave, tipo: archivo.type, tamano: archivo.size });
      const subida = await fetch(direccion, { method: 'PUT', headers: { 'Content-Type': archivo.type }, body: archivo });
      if (!subida.ok) throw new Error('No se pudo subir el archivo. Intenta de nuevo.');
      subidos[clave] = ruta; caja.className = 'archivo listo'; estado.textContent = 'Recibido: ' + archivo.name;
    } catch (error) { fallo(error.message === 'Failed to fetch' ? 'No se pudo subir el archivo. Revisa tu conexión e intenta de nuevo.' : error.message); }
    alCambiar();
  } });
  caja.append(h('label', { for: clave }, titulo), h('p', { clase: 'ayuda' }, ayuda), entrada, estado);
  return caja;
}

function pintarFormulario(servicio) {
  const correo = h('input', { type: 'email', id: 'correo', required: true, autocomplete: 'email', placeholder: 'ejemplo@correo.com' });
  const acepta = h('input', { type: 'checkbox', id: 'acepta' });
  const error = h('p', { clase: 'error', role: 'alert' });
  const boton = h('button', { type: 'submit', disabled: true }, 'Enviar documentos');
  const revisar = () => { boton.disabled = !(DOCUMENTOS.every(([clave]) => subidos[clave]) && acepta.checked && correo.validity.valid && correo.value); };
  correo.addEventListener('input', revisar); acepta.addEventListener('change', revisar);
  raiz.replaceChildren(h('form', { clase: 'tarjeta', novalidate: true, alSubmit: async (evento) => {
    evento.preventDefault();
    boton.disabled = true; boton.textContent = 'Enviando…'; error.textContent = '';
    try {
      await pedir('/api/formulario/enviar', { correo: correo.value.trim(), acepta: acepta.checked, archivos: subidos });
      mensaje('¡Listo! Recibimos tus documentos', 'Tu asesora los revisará y te escribirá por WhatsApp. Ya puedes cerrar esta página.', true);
    } catch (fallo) { error.textContent = fallo.message; boton.textContent = 'Enviar documentos'; revisar(); }
  } },
    h('h2', null, servicio),
    h('p', { clase: 'ayuda' }, 'Solo necesitamos tu correo y tres documentos. Tu nombre, cédula, universidad y título los tomamos de los documentos, así que no tienes que escribirlos.'),
    h('label', { for: 'correo' }, 'Correo electrónico'), correo,
    DOCUMENTOS.map((documento) => campoArchivo(documento, revisar)),
    h('label', { clase: 'acepto', for: 'acepta' }, acepta, h('span', null, 'Acepto los términos y condiciones y la política de privacidad, y autorizo el tratamiento de mis datos y documentos para realizar el trámite, incluida su lectura automática.')),
    boton, error));
}

pedir('/api/formulario/ver')
  .then(({ servicio, enviado }) => enviado
    ? mensaje('Ya recibimos tus documentos', 'Si necesitas cambiar alguno, escríbele a tu asesora por WhatsApp.', true)
    : pintarFormulario(servicio))
  .catch((error) => mensaje('No pudimos abrir tu registro', error.message === 'Este enlace no es valido' ? 'El enlace no es válido. Pídele a tu asesora que te lo envíe de nuevo.' : error.message, false));
</script>
</body>
</html>`;
