import { CategoriaActuacion } from './tipos';

/** El orden importa: "INADMITE" contiene "ADMITE" y "CONCEDE IMPUGNACION" no es un fallo. */
const REGLAS: ReadonlyArray<readonly [RegExp, CategoriaActuacion]> = [
  [/DESACATO/, 'DESACATO'],
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
  const texto = sinTildes(`${titulo} ${anotacion ?? ''}`);
  const regla = REGLAS.find(([patron]) => patron.test(texto));
  return regla ? regla[1] : 'OTRA';
}
