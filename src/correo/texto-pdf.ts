import { Worker } from 'node:worker_threads';

/** Un acta de reparto tiene una o dos paginas; no hace falta leer mas. */
const PAGINAS_MAXIMAS = 5;
const ESPERA_MAXIMA_MS = 15_000;
const MEMORIA_MAXIMA_MB = 256;
const TEXTO_MAXIMO = 50_000;

/** Se ejecuta en un hilo aparte: un PDF hostil no puede bloquear ni tumbar el servicio. */
const CODIGO_DEL_HILO = `
const { parentPort, workerData } = require('node:worker_threads');
const { PDFParse } = require(workerData.modulo);
(async () => {
  const lector = new PDFParse({ data: workerData.datos });
  const leido = await lector.getText({ first: workerData.paginas });
  parentPort.postMessage(String(leido.text).slice(0, workerData.maximo));
})().catch(() => parentPort.postMessage(''));
`;

/**
 * Texto de las primeras paginas de un PDF. Devuelve vacio si el archivo no es un PDF legible,
 * esta protegido, es una imagen escaneada, tarda demasiado o consume demasiada memoria.
 */
export function textoDePdf(contenido: Buffer): Promise<string> {
  if (contenido.length === 0) return Promise.resolve('');
  return new Promise((resolver) => {
    const hilo = new Worker(CODIGO_DEL_HILO, {
      eval: true,
      workerData: { modulo: require.resolve('pdf-parse'), datos: new Uint8Array(contenido), paginas: PAGINAS_MAXIMAS, maximo: TEXTO_MAXIMO },
      resourceLimits: { maxOldGenerationSizeMb: MEMORIA_MAXIMA_MB },
    });
    let resuelto = false;
    const terminar = (texto: string) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(reloj);
      void hilo.terminate();
      resolver(texto);
    };
    const reloj = setTimeout(() => terminar(''), ESPERA_MAXIMA_MS);
    hilo.once('message', (texto: unknown) => terminar(typeof texto === 'string' ? texto : ''));
    hilo.once('error', () => terminar(''));
    hilo.once('exit', () => terminar(''));
  });
}
