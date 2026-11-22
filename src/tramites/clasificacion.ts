import { CategoriaActuacion } from './tipos';

/** El orden importa: "INADMITE" contiene "ADMITE" y "CONCEDE IMPUGNACION" no es un fallo. */
const REGLAS: ReadonlyArray<readonly [RegExp, CategoriaActuacion]> = [
  [/DESACATO/, 'DESACATO'],
  [/REMITE.*CORTE CONSTITUCIONAL/, 'REMISION_CORTE'],
  [/IMPUGNA/, 'IMPUGNACION'],
  [/SENTENCIA|FALLO/, 'FALLO'],
  [/INADMITE|REQUIERE|REQUERIMIENTO|SUBSANA/, 'REQUERIMIENTO'],
  [/ADMITE|ADMISORIO|AVOCA/, 'ADMISION'],
];

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/** Clasificacion aproximada por palabras clave. Es una ayuda, no reemplaza leer la actuacion. */
export function clasificarActuacion(titulo: string, anotacion: string | null): CategoriaActuacion {
  const porTitulo = REGLAS.find(([patron]) => patron.test(sinTildes(titulo)));
  if (porTitulo) return porTitulo[1];
  // La anotacion suele mencionar el fallo que vendra ("se fallara en 10 dias"): no cuenta como fallo.
  const porAnotacion = REGLAS.find(
    ([patron, categoria]) => categoria !== 'FALLO' && patron.test(sinTildes(anotacion ?? '')),
  );
  return porAnotacion ? porAnotacion[1] : 'OTRA';
}
