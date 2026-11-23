import { CategoriaActuacion } from './tipos';

/** El orden importa: "INADMITE" contiene "ADMITE" y "CONCEDE IMPUGNACION" no es un fallo. */
const REGLAS: ReadonlyArray<readonly [RegExp, CategoriaActuacion]> = [
  [/DESACATO/, 'DESACATO'],
  [/(REMIT|ENVI)\w*.*CORTE CONSTITUCIONAL/, 'REMISION_CORTE'],
  [/IMPUGNA/, 'IMPUGNACION'],
  [/SENTENCIA|FALLO|REVOCA|CONFIRMA/, 'FALLO'],
  [/INADMITE|REQUIERE|REQUERIMIENTO|SUBSANA/, 'REQUERIMIENTO'],
  [/ADMITE|ADMISORIO|AVOCA/, 'ADMISION'],
];

const PASO_AL_DESPACHO = /^AL DESPACHO/;
const ANOTACION_ES_FALLO = /^(SENTENCIA|FALLO)\b/;

export function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/** Clasificacion aproximada por palabras clave. Es una ayuda, no reemplaza leer la actuacion. */
export function clasificarActuacion(titulo: string, anotacion: string | null): CategoriaActuacion {
  // "Al despacho para fallo" anuncia la decision, no la contiene.
  if (PASO_AL_DESPACHO.test(sinTildes(titulo).trim())) return 'OTRA';
  const porTitulo = REGLAS.find(([patron]) => patron.test(sinTildes(titulo)));
  if (porTitulo) return porTitulo[1];
  // Algunos despachos titulan "Sustanciacion" y escriben la decision en la anotacion: "Sentencia concede".
  if (ANOTACION_ES_FALLO.test(sinTildes(anotacion ?? '').trim())) return 'FALLO';
  // La anotacion suele mencionar el fallo que vendra ("se fallara en 10 dias"): no cuenta como fallo.
  const porAnotacion = REGLAS.find(
    ([patron, categoria]) => categoria !== 'FALLO' && patron.test(sinTildes(anotacion ?? '')),
  );
  return porAnotacion ? porAnotacion[1] : 'OTRA';
}
