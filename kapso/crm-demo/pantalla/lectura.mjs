// Lectura automatica de los documentos que llegan por el formulario web.
// Usa Claude en Amazon Bedrock con el permiso del propio programa: no necesita llave.
// Se ejecuta aparte, despues de responderle al cliente, porque puede tardar hasta un minuto.

export const MODELO = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const NOMBRES = { cedula: 'Cedula o pasaporte', titulo: 'Diploma o certificacion supletoria', notas: 'Certificado academico de notas' };
const FORMATOS = { pdf: 'pdf', jpg: 'jpeg', png: 'png' };
// Bedrock rechaza solicitudes muy pesadas; por encima de esto el documento lo revisa la asesora.
const MAXIMO_PARA_LEER = 4.4 * 1024 * 1024;

const INSTRUCCIONES = `Eres un asistente de Apostillas y Legalizaciones, una firma colombiana que tramita apostillas de títulos universitarios.
Recibes los tres documentos que un cliente subió por el formulario de registro, cada uno con el nombre de lo que el cliente dijo que era.
Lee los documentos y llama a la herramienta registrar con los datos. Reglas:
- Copia los datos tal como aparecen. Lo que no se lea con seguridad déjalo vacío: nunca inventes ni completes.
- La cédula va solo con dígitos, sin puntos. Si el documento de identidad es un pasaporte, escribe su número tal cual.
- Las fechas van como aparecen en el documento.
- En cada documento indica si corresponde a lo que el cliente dijo y si es legible. Solo importa que se pueda leer.
- En diferencias anota, en una frase, si el nombre o el número de identificación no coinciden entre documentos, o si un documento es de otra persona. Si todo coincide, déjalo vacío.
- En legibilidad nombra los documentos borrosos, cortados u oscuros. Si todos se leen bien, déjalo vacío.`;

const texto = { type: 'string' };
const HERRAMIENTA = {
  toolSpec: {
    name: 'registrar',
    description: 'Registra los datos del cliente leídos de sus documentos.',
    inputSchema: { json: {
      type: 'object',
      properties: {
        nombre: { ...texto, description: 'Nombres y apellidos completos.' },
        cedula: texto, fecha_nacimiento: texto, universidad: texto,
        titulo: { ...texto, description: 'Nombre del título obtenido.' },
        fecha_grado: texto, codigo_verificacion: texto, diferencias: texto, legibilidad: texto,
        documentos: {
          type: 'array',
          items: { type: 'object', properties: { documento: { type: 'string', enum: Object.keys(NOMBRES) }, corresponde: { type: 'boolean' }, legible: { type: 'boolean' } }, required: ['documento', 'corresponde', 'legible'] },
        },
      },
      required: ['nombre', 'cedula', 'universidad', 'titulo', 'diferencias', 'legibilidad', 'documentos'],
    } },
  },
};

function bloque(documento, ruta, bytes) {
  const formato = FORMATOS[ruta.split('.').pop()];
  if (!formato) throw new Error(`Tipo de archivo no admitido: ${documento}`);
  return formato === 'pdf'
    ? { document: { format: 'pdf', name: documento, source: { bytes } } }
    : { image: { format: formato, source: { bytes } } };
}

/** Observaciones para la asesora a partir de lo que dijo el modelo sobre cada documento. */
function observaciones(datos) {
  const notas = [];
  for (const item of Array.isArray(datos.documentos) ? datos.documentos : []) {
    if (item.corresponde === false) notas.push(`${NOMBRES[item.documento] || item.documento}: no parece ser ese documento`);
    if (item.legible === false) notas.push(`${NOMBRES[item.documento] || item.documento}: no se lee bien`);
  }
  return notas.join('; ');
}

/**
 * Lee los documentos de una venta y devuelve lo que hay que guardar en el sistema.
 * `leer(ruta)` entrega los bytes de un archivo y `conversar(solicitud)` llama al modelo.
 */
export async function leerDocumentos(archivos, { leer, conversar }) {
  const contenido = [];
  const omitidos = [];
  for (const [documento, ruta] of Object.entries(archivos)) {
    const bytes = await leer(ruta);
    if (bytes.length > MAXIMO_PARA_LEER) { omitidos.push(NOMBRES[documento] || documento); continue; }
    contenido.push({ text: `Documento que el cliente subió como: ${NOMBRES[documento] || documento}` }, bloque(documento, ruta, bytes));
  }
  if (!contenido.length) return { lectura: { estado: 'fallida', observaciones: 'Los archivos son muy pesados para la lectura automática' } };
  const respuesta = await conversar({
    modelId: MODELO,
    system: [{ text: INSTRUCCIONES }],
    messages: [{ role: 'user', content: [...contenido, { text: 'Lee los documentos y registra los datos.' }] }],
    toolConfig: { tools: [HERRAMIENTA], toolChoice: { tool: { name: 'registrar' } } },
    inferenceConfig: { maxTokens: 2000 },
  });
  const uso = (respuesta.output?.message?.content || []).find((parte) => parte.toolUse?.name === 'registrar');
  if (!uso) return { lectura: { estado: 'fallida', observaciones: 'El modelo no entregó los datos' } };
  const datos = uso.toolUse.input || {};
  const pesados = omitidos.length ? `No se leyeron por su peso: ${omitidos.join(', ')}` : '';
  return {
    nombre: datos.nombre, cedula: datos.cedula, fecha_nacimiento: datos.fecha_nacimiento, universidad: datos.universidad, titulo: datos.titulo,
    fecha_grado: datos.fecha_grado, codigo_verificacion: datos.codigo_verificacion, diferencias: datos.diferencias, legibilidad: datos.legibilidad,
    lectura: { estado: 'hecha', observaciones: [observaciones(datos), pesados].filter(Boolean).join('; ') },
  };
}
