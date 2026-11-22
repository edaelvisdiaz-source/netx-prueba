/** Fechas como texto `YYYY-MM-DD`, siempre en calendario de Colombia. */
export type FechaISO = string;

const MS_DIA = 86_400_000;
const FESTIVOS_FIJOS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25],
];
/** Ley 51 de 1983: se trasladan al lunes siguiente. */
const FESTIVOS_TRASLADABLES: ReadonlyArray<readonly [number, number]> = [
  [1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11],
];
/** Dias desde el domingo de Pascua. Los tres ultimos ya caen en lunes. */
const FESTIVOS_PASCUA: ReadonlyArray<number> = [-3, -2, 43, 64, 71];

const cacheFestivos = new Map<number, ReadonlySet<FechaISO>>();

function aUTC(fecha: FechaISO): Date {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function aISO(fecha: Date): FechaISO {
  return fecha.toISOString().slice(0, 10);
}

function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * MS_DIA);
}

function siguienteLunes(fecha: Date): Date {
  const diaSemana = fecha.getUTCDay();
  return diaSemana === 1 ? fecha : sumarDias(fecha, (8 - diaSemana) % 7);
}

/** Domingo de Pascua (algoritmo gregoriano anonimo). */
export function domingoDePascua(anio: number): FechaISO {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return aISO(new Date(Date.UTC(anio, mes - 1, dia)));
}

export function festivosDeColombia(anio: number): ReadonlySet<FechaISO> {
  const enCache = cacheFestivos.get(anio);
  if (enCache) return enCache;
  const pascua = aUTC(domingoDePascua(anio));
  const festivos = new Set<FechaISO>([
    ...FESTIVOS_FIJOS.map(([mes, dia]) => aISO(new Date(Date.UTC(anio, mes - 1, dia)))),
    ...FESTIVOS_TRASLADABLES.map(([mes, dia]) =>
      aISO(siguienteLunes(new Date(Date.UTC(anio, mes - 1, dia)))),
    ),
    ...FESTIVOS_PASCUA.map((dias) => aISO(sumarDias(pascua, dias))),
  ]);
  cacheFestivos.set(anio, festivos);
  return festivos;
}

export function esDiaHabil(fecha: FechaISO): boolean {
  const dia = aUTC(fecha);
  const diaSemana = dia.getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) return false;
  return !festivosDeColombia(dia.getUTCFullYear()).has(fecha);
}

/** Fecha que resulta de contar `dias` dias habiles despues de `desde` (sin incluirlo). */
export function sumarDiasHabiles(desde: FechaISO, dias: number): FechaISO {
  if (!Number.isInteger(dias) || dias < 0) {
    throw new RangeError('dias debe ser un entero mayor o igual a cero');
  }
  let actual = aUTC(desde);
  let restantes = dias;
  while (restantes > 0) {
    actual = sumarDias(actual, 1);
    if (esDiaHabil(aISO(actual))) restantes -= 1;
  }
  return aISO(actual);
}

/** Dias habiles en el intervalo (desde, hasta]. Negativo si `hasta` es anterior a `desde`. */
export function diasHabilesEntre(desde: FechaISO, hasta: FechaISO): number {
  if (desde === hasta) return 0;
  if (hasta < desde) return -diasHabilesEntre(hasta, desde);
  let actual = aUTC(desde);
  const fin = aUTC(hasta);
  let cuenta = 0;
  while (actual < fin) {
    actual = sumarDias(actual, 1);
    if (esDiaHabil(aISO(actual))) cuenta += 1;
  }
  return cuenta;
}

/** Fecha de hoy en Colombia (UTC-5, sin horario de verano). */
export function hoyEnColombia(ahora: Date = new Date()): FechaISO {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora);
}

/** Toma la parte de fecha de un texto de la fuente; `null` si no es una fecha valida. */
export function soloFecha(valor: string | null | undefined): FechaISO | null {
  if (!valor) return null;
  const fecha = valor.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  return Number.isNaN(aUTC(fecha).getTime()) ? null : fecha;
}
