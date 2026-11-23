import { diasHabilesEntre, FechaISO } from '../terminos/dias-habiles';
import { calcularTerminosTutela, Termino } from '../terminos/tutela';
import { sinTildes } from './clasificacion';
import { CategoriaActuacion, EstadoTramite, FuenteId, TipoTramite } from './tipos';

/** Etapas de una tutela. Las calcula Radika con las actuaciones; una persona puede fijar otra a mano. */
export const ETAPAS = [
  'SIN_DATOS', 'RADICADA', 'REQUERIMIENTO', 'ADMITIDA', 'FALLO_FAVORABLE', 'FALLO_DESFAVORABLE', 'CARENCIA_OBJETO',
  'FALLO_SIN_CLASIFICAR', 'FALLO_SEGUNDA_INSTANCIA', 'IMPUGNADA', 'DESACATO', 'EN_CORTE', 'REMITIDA_OTRO_DESPACHO', 'CUMPLIDA',
] as const;
export type Etapa = (typeof ETAPAS)[number];

export const NIVELES = ['URGENTE', 'PRONTO', 'INFO'] as const;
export type Nivel = (typeof NIVELES)[number];

export interface Alerta {
  readonly nivel: Nivel;
  readonly motivo: string;
  readonly fechaLimite: FechaISO | null;
}

export interface ActuacionParaSituacion {
  readonly fecha: FechaISO;
  readonly categoria: CategoriaActuacion;
  readonly titulo: string;
  readonly anotacion: string | null;
  readonly detectadaAt: Date;
}

export interface DatosSituacion {
  readonly tipo: TipoTramite;
  /** Un trámite pausado o cerrado no genera alertas ni vencimientos. */
  readonly estado: EstadoTramite;
  readonly fuente: FuenteId;
  readonly clienteNombre: string | null;
  readonly sujetos: string | null;
  readonly fechaRadicacion: FechaISO | null;
  readonly etapaManual: Etapa | null;
  readonly etapaManualAt: Date | null;
  readonly estadoFuente: string | null;
  readonly credencialRechazada: boolean;
  readonly ultimoError: string | null;
  readonly erroresConsecutivos: number;
  readonly sincronizadoAt: Date | null;
  readonly createdAt: Date;
  readonly actuaciones: ReadonlyArray<ActuacionParaSituacion>;
  readonly hoy: FechaISO;
}

export interface Situacion {
  readonly etapa: Etapa | null;
  readonly etapaAutomatica: Etapa | null;
  readonly esManual: boolean;
  readonly tutelante: string | null;
  readonly accionado: string | null;
  readonly ultimaNovedad: { readonly fecha: FechaISO; readonly titulo: string; readonly anotacion: string | null } | null;
  /** Frase corta con el ultimo estado del tramite. */
  readonly nota: string;
  /** Orientacion general segun la etapa. No reemplaza la lectura de la providencia ni el criterio del abogado. */
  readonly recomendacion: string | null;
  readonly atencion: ReadonlyArray<Alerta>;
  readonly nivel: Nivel | null;
  readonly proximoVencimiento: FechaISO | null;
  readonly terminos: ReadonlyArray<Termino>;
}

const ROL_TUTELANTE = /DEMANDANTE|ACCIONANTE|TUTELANTE/;
const ROL_ACCIONADO = /DEMANDADO|ACCIONADO/;
const PALABRAS_MENORES: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
const ERRORES_PARA_AVISAR = 3;
const DIAS_SIN_APARECER = 2;
const DIAS_SIN_ADMISION = 3;
const DIAS_VERIFICAR_CUMPLIMIENTO = 5;
const DIAS_NOVEDAD_RECIENTE = 1;
const MS_DIA = 86_400_000;
const ORDEN_NIVEL: Readonly<Record<Nivel, number>> = { URGENTE: 0, PRONTO: 1, INFO: 2 };

function nombreLegible(nombre: string): string {
  return nombre
    .toLocaleLowerCase('es')
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra, indice) => (indice > 0 && PALABRAS_MENORES.has(palabra) ? palabra : palabra.charAt(0).toLocaleUpperCase('es') + palabra.slice(1)))
    .join(' ');
}

/** Lee "Demandante: X | Demandado: Y" tal como lo publica la Rama Judicial. */
export function leerPartes(sujetos: string | null): { tutelante: string | null; accionado: string | null } {
  const pares = (sujetos ?? '')
    .split('|')
    .map((parte) => parte.split(':'))
    .filter((trozos) => trozos.length >= 2)
    .map(([rol, ...resto]) => ({ rol: sinTildes(rol), nombre: resto.join(':').trim() }))
    .filter((par) => par.nombre.length > 0);
  const unir = (patron: RegExp) => pares.filter((par) => patron.test(par.rol)).map((par) => nombreLegible(par.nombre)).join(', ') || null;
  return { tutelante: unir(ROL_TUTELANTE), accionado: unir(ROL_ACCIONADO) };
}

const FALLO_CARENCIA = /CARENCIA|HECHO SUPERADO/;
const FALLO_EN_CONTRA = /NIEGA|NEGAR|IMPROCEDEN|RECHAZA|NO (SE )?(CONCEDE|TUTELA|AMPARA)/;
const FALLO_DEL_SUPERIOR = /REVOCA|CONFIRMA|MODIFICA/;
const CAMBIO_DE_DESPACHO = /POR COMPETENCIA|FALTA DE COMPETENCIA/;
const ENTIDAD_REPORTA_CUMPLIMIENTO = /CUMPLIMIENTO/;
const FALLO_A_FAVOR = /CONCEDE|AMPARA|TUTELA(R)? (EL|LOS|LA|LAS) |PROTEGE/;

/** Sentido aproximado del fallo segun la anotacion del juzgado. Si no es claro, queda sin clasificar. */
export function sentidoDelFallo(titulo: string, anotacion: string | null): Etapa {
  const texto = sinTildes(`${titulo} ${anotacion ?? ''}`);
  if (FALLO_DEL_SUPERIOR.test(texto)) return 'FALLO_SEGUNDA_INSTANCIA';
  if (FALLO_CARENCIA.test(texto)) return 'CARENCIA_OBJETO';
  if (FALLO_EN_CONTRA.test(texto)) return 'FALLO_DESFAVORABLE';
  if (FALLO_A_FAVOR.test(texto)) return 'FALLO_FAVORABLE';
  return 'FALLO_SIN_CLASIFICAR';
}

function enOrden(actuaciones: ReadonlyArray<ActuacionParaSituacion>): ActuacionParaSituacion[] {
  return [...actuaciones].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.detectadaAt.getTime() - b.detectadaAt.getTime());
}

function siguienteEtapa(actual: Etapa, actuacion: ActuacionParaSituacion): Etapa {
  switch (actuacion.categoria) {
    case 'ADMISION': return actual === 'RADICADA' || actual === 'REQUERIMIENTO' ? 'ADMITIDA' : actual;
    case 'REQUERIMIENTO': return actual === 'RADICADA' ? 'REQUERIMIENTO' : actual;
    case 'FALLO': return sentidoDelFallo(actuacion.titulo, actuacion.anotacion);
    case 'IMPUGNACION': return 'IMPUGNADA';
    case 'DESACATO': return 'DESACATO';
    case 'REMISION_CORTE': return 'EN_CORTE';
    default: {
      const texto = sinTildes(`${actuacion.titulo} ${actuacion.anotacion ?? ''}`);
      if (actual === 'RADICADA' && CAMBIO_DE_DESPACHO.test(texto)) return 'REMITIDA_OTRO_DESPACHO';
      // Si la entidad reporta que cumplio, el fallo cuyo sentido no se pudo leer le ordeno algo.
      if (actual === 'FALLO_SIN_CLASIFICAR' && ENTIDAD_REPORTA_CUMPLIMIENTO.test(texto)) return 'FALLO_FAVORABLE';
      return actual;
    }
  }
}

export function etapaAutomatica(fechaRadicacion: FechaISO | null, actuaciones: ReadonlyArray<ActuacionParaSituacion>): Etapa {
  if (!fechaRadicacion && actuaciones.length === 0) return 'SIN_DATOS';
  return enOrden(actuaciones).reduce<Etapa>(siguienteEtapa, 'RADICADA');
}

const ETAPAS_CON_FALLO_A_IMPUGNAR: ReadonlySet<Etapa> = new Set(['FALLO_DESFAVORABLE', 'CARENCIA_OBJETO', 'FALLO_SIN_CLASIFICAR']);
const ETAPAS_SIN_PLAZOS: ReadonlySet<Etapa> = new Set(['CUMPLIDA', 'REMITIDA_OTRO_DESPACHO', 'FALLO_SEGUNDA_INSTANCIA', 'EN_CORTE']);
const FECHA_LARGA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function enPalabras(fecha: FechaISO): string {
  return FECHA_LARGA.format(new Date(`${fecha}T12:00:00Z`));
}

function recomendar(etapa: Etapa, terminos: ReadonlyArray<Termino>): string | null {
  const fallo = terminos.find((termino) => termino.clave === 'FALLO_PRIMERA_INSTANCIA');
  const impugnacion = terminos.find((termino) => termino.clave === 'IMPUGNACION');
  const hasta = impugnacion && impugnacion.estado !== 'VENCIDO' ? ` El plazo estimado para impugnar va hasta el ${enPalabras(impugnacion.fechaLimite)} (3 días hábiles desde la notificación).` : '';
  switch (etapa) {
    case 'SIN_DATOS': return 'La consulta de la Rama Judicial aún no muestra este radicado. Verifica el número o espera a que el despacho lo publique.';
    case 'RADICADA': return 'Aun no hay auto que admita la tutela. Si pasan más de 3 días hábiles, consulta al juzgado por el reparto o la admisión.';
    case 'REQUERIMIENTO': return 'El juzgado pidió corregir o completar algo antes de admitir. Lee el auto y responde dentro del plazo que fija (suele ser de 3 días); si no se subsana, la tutela puede ser rechazada.';
    case 'ADMITIDA':
      return fallo && fallo.estado === 'VENCIDO'
        ? 'El plazo de 10 días hábiles para fallar ya venció. Considera un memorial pidiendo que se profiera el fallo.'
        : `Tutela admitida. El juez tiene 10 días hábiles para fallar${fallo ? ` (hasta el ${enPalabras(fallo.fechaLimite)})` : ''}. Por ahora solo hay que estar pendiente de las respuestas de la entidad.`;
    case 'FALLO_FAVORABLE': return 'Fallo a favor. Verifica que la entidad cumpla dentro del plazo que ordenó el juez (normalmente 48 horas). Si no cumple, procede el incidente de desacato.';
    case 'FALLO_DESFAVORABLE': return `Fallo en contra. Evalúa con el abogado si se impugna.${hasta}`;
    case 'CARENCIA_OBJETO': return `El juez consideró que ya no había nada que ordenar (suele ser porque la entidad respondió durante el trámite). Confirma que la respuesta resuelve de verdad lo pedido; si no, se puede impugnar.${hasta}`;
    case 'FALLO_SIN_CLASIFICAR': return `Hay fallo, pero la anotacion no deja claro el sentido. Lee la sentencia y marca la etapa a mano.${hasta}`;
    case 'FALLO_SEGUNDA_INSTANCIA': return 'El juez de segunda instancia ya decidió la impugnación. Lee si confirmó o revocó el primer fallo: esa decisión es definitiva, salvo que la Corte Constitucional la escoja para revisión.';
    case 'REMITIDA_OTRO_DESPACHO': return 'El juzgado envió la tutela a otro despacho por competencia. Allí recibe un radicado nuevo: búscalo en el correo de reparto y regístralo para seguirla; este trámite se puede cerrar.';
    case 'IMPUGNADA': return 'El fallo fue impugnado. El juez de segunda instancia tiene 20 días hábiles para decidir desde que recibe el expediente.';
    case 'DESACATO': return 'Hay un incidente de desacato en curso. Revisa los requerimientos del juzgado y aporta la prueba del incumplimiento.';
    case 'EN_CORTE': return 'El expediente fue enviado a la Corte Constitucional para eventual revisión. Es el paso normal después del fallo y casi nunca requiere una acción.';
    case 'CUMPLIDA': return null;
  }
}

const TEXTO_ETAPA: Readonly<Record<Etapa, string>> = {
  SIN_DATOS: 'Sin datos de la fuente todavía', RADICADA: 'Radicada, pendiente de admisión', REQUERIMIENTO: 'El juzgado hizo un requerimiento',
  ADMITIDA: 'Admitida, en espera del fallo', FALLO_FAVORABLE: 'Fallo a favor', FALLO_DESFAVORABLE: 'Fallo en contra',
  CARENCIA_OBJETO: 'Fallo: carencia de objeto', FALLO_SIN_CLASIFICAR: 'Hay fallo (sentido por confirmar)', IMPUGNADA: 'Impugnada, en segunda instancia',
  FALLO_SEGUNDA_INSTANCIA: 'Fallo de segunda instancia', REMITIDA_OTRO_DESPACHO: 'Remitida a otro despacho por competencia',
  DESACATO: 'Incidente de desacato', EN_CORTE: 'Enviada a la Corte Constitucional', CUMPLIDA: 'Fallo cumplido',
};

function alertasDeTutela(datos: DatosSituacion, etapa: Etapa, automatica: Etapa, terminos: ReadonlyArray<Termino>): Alerta[] {
  const alertas: Alerta[] = [];
  const fallo = terminos.find((termino) => termino.clave === 'FALLO_PRIMERA_INSTANCIA');
  const impugnacion = terminos.find((termino) => termino.clave === 'IMPUGNACION');
  const orden = enOrden(datos.actuaciones);

  if (datos.etapaManual && datos.etapaManualAt && automatica !== datos.etapaManual) {
    const desde = datos.etapaManualAt.getTime();
    const posterior = orden.filter((actuacion) => actuacion.categoria !== 'OTRA' && actuacion.detectadaAt.getTime() > desde).pop();
    if (posterior) alertas.push({ nivel: 'PRONTO', motivo: `Llegó una novedad después del cambio manual de etapa: ${posterior.titulo}`, fechaLimite: null });
  }
  if (etapa === 'CUMPLIDA') return alertas;

  if (etapa === 'REQUERIMIENTO') alertas.push({ nivel: 'URGENTE', motivo: 'El juzgado hizo un requerimiento antes de admitir', fechaLimite: null });
  if (ETAPAS_CON_FALLO_A_IMPUGNAR.has(etapa) && impugnacion?.estado === 'POR_VENCER') {
    alertas.push({ nivel: 'URGENTE', motivo: `El plazo para impugnar vence el ${enPalabras(impugnacion.fechaLimite)}`, fechaLimite: impugnacion.fechaLimite });
  }
  if (etapa === 'FALLO_SIN_CLASIFICAR') alertas.push({ nivel: 'PRONTO', motivo: 'Hay fallo y falta confirmar si fue a favor o en contra', fechaLimite: null });
  if (etapa === 'ADMITIDA' && fallo?.estado === 'VENCIDO') {
    alertas.push({ nivel: 'URGENTE', motivo: `El juez no ha fallado y el plazo venció el ${enPalabras(fallo.fechaLimite)}`, fechaLimite: fallo.fechaLimite });
  }
  if (etapa === 'RADICADA' && fallo?.estado === 'VENCIDO') {
    alertas.push({ nivel: 'PRONTO', motivo: `La consulta no muestra admisión ni fallo y el plazo venció el ${enPalabras(fallo.fechaLimite)}: confirma con el juzgado, puede no estar actualizada`, fechaLimite: fallo.fechaLimite });
  }
  if (etapa === 'REMITIDA_OTRO_DESPACHO') alertas.push({ nivel: 'PRONTO', motivo: 'Fue enviada a otro despacho: registra el radicado nuevo', fechaLimite: null });
  if ((etapa === 'RADICADA' || etapa === 'ADMITIDA') && fallo?.estado === 'POR_VENCER') {
    alertas.push({ nivel: 'PRONTO', motivo: `El fallo debe salir a más tardar el ${enPalabras(fallo.fechaLimite)}`, fechaLimite: fallo.fechaLimite });
  }
  if (etapa === 'RADICADA' && datos.fechaRadicacion && fallo?.estado === 'EN_CURSO' && diasHabilesEntre(datos.fechaRadicacion, datos.hoy) > DIAS_SIN_ADMISION) {
    alertas.push({ nivel: 'PRONTO', motivo: 'Lleva más de 3 días hábiles sin auto de admisión', fechaLimite: null });
  }
  const ultimoFallo = orden.filter((actuacion) => actuacion.categoria === 'FALLO').pop();
  if (etapa === 'FALLO_FAVORABLE' && ultimoFallo && diasHabilesEntre(ultimoFallo.fecha, datos.hoy) <= DIAS_VERIFICAR_CUMPLIMIENTO) {
    alertas.push({ nivel: 'PRONTO', motivo: 'Fallo a favor: verificar que la entidad cumpla', fechaLimite: null });
  }
  if (etapa === 'FALLO_SEGUNDA_INSTANCIA' && ultimoFallo && diasHabilesEntre(ultimoFallo.fecha, datos.hoy) <= DIAS_VERIFICAR_CUMPLIMIENTO) {
    alertas.push({ nivel: 'PRONTO', motivo: 'Hay decisión de segunda instancia: revisa si confirmó o revocó', fechaLimite: null });
  }
  if (etapa === 'DESACATO') alertas.push({ nivel: 'PRONTO', motivo: 'Incidente de desacato en curso', fechaLimite: null });
  return alertas;
}

function alertasGenerales(datos: DatosSituacion): Alerta[] {
  const alertas: Alerta[] = [];
  if (datos.credencialRechazada) alertas.push({ nivel: 'URGENTE', motivo: 'La plataforma rechazó el usuario o la clave: registra la credencial correcta', fechaLimite: null });
  if (datos.ultimoError && datos.erroresConsecutivos >= ERRORES_PARA_AVISAR) {
    alertas.push({ nivel: 'INFO', motivo: `Radika no ha podido consultarlo: ${datos.ultimoError}`, fechaLimite: null });
  }
  const diasRegistrado = (Date.parse(`${datos.hoy}T12:00:00Z`) - datos.createdAt.getTime()) / MS_DIA;
  if (datos.fuente === 'RAMA_JUDICIAL_CPNU' && !datos.sincronizadoAt && diasRegistrado >= DIAS_SIN_APARECER) {
    alertas.push({ nivel: 'INFO', motivo: 'No aparece en la consulta de la Rama Judicial: verifica el radicado', fechaLimite: null });
  }
  return alertas;
}

function ordenar(alertas: ReadonlyArray<Alerta>): Alerta[] {
  return [...alertas].sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || (a.fechaLimite ?? '9999').localeCompare(b.fechaLimite ?? '9999'));
}

/** Resume en que va un tramite, que conviene hacer y si necesita atencion. */
export function calcularSituacion(datos: DatosSituacion): Situacion {
  const partes = leerPartes(datos.sujetos);
  const ultima = enOrden(datos.actuaciones).pop() ?? null;
  const ultimaNovedad = ultima ? { fecha: ultima.fecha, titulo: ultima.titulo, anotacion: ultima.anotacion } : null;
  const comun = { tutelante: datos.clienteNombre ?? partes.tutelante, accionado: partes.accionado, ultimaNovedad };

  const vigente = datos.estado === 'ACTIVO';

  if (datos.tipo !== 'TUTELA') {
    const atencion = vigente ? ordenar(alertasGenerales(datos)) : [];
    const nota = datos.estadoFuente ? `Estado en la plataforma: ${datos.estadoFuente}` : ultima ? `Último movimiento: ${ultima.titulo}` : 'Sin movimientos registrados';
    return {
      ...comun, etapa: datos.etapaManual, etapaAutomatica: null, esManual: datos.etapaManual !== null, nota, recomendacion: null,
      atencion, nivel: atencion[0]?.nivel ?? null, proximoVencimiento: null, terminos: [],
    };
  }

  const terminos = calcularTerminosTutela({ fechaRadicacion: datos.fechaRadicacion, actuaciones: datos.actuaciones, hoy: datos.hoy });
  const automatica = etapaAutomatica(datos.fechaRadicacion, datos.actuaciones);
  const etapa = datos.etapaManual ?? automatica;
  const atencion = vigente ? ordenar([...alertasDeTutela(datos, etapa, automatica, terminos), ...alertasGenerales(datos)]) : [];
  const pendientes = terminos
    .filter((termino) => termino.estado === 'EN_CURSO' || termino.estado === 'POR_VENCER')
    .filter((termino) => termino.clave !== 'IMPUGNACION' || ETAPAS_CON_FALLO_A_IMPUGNAR.has(etapa))
    .map((termino) => termino.fechaLimite)
    .sort();
  const reciente = ultima && diasHabilesEntre(ultima.fecha, datos.hoy) <= DIAS_NOVEDAD_RECIENTE ? ' (novedad reciente)' : '';
  return {
    ...comun, etapa, etapaAutomatica: automatica, esManual: datos.etapaManual !== null,
    nota: `${TEXTO_ETAPA[etapa]}${ultima ? `. Último movimiento: ${ultima.titulo}${reciente}` : ''}`,
    recomendacion: recomendar(etapa, terminos),
    atencion, nivel: atencion[0]?.nivel ?? null,
    proximoVencimiento: ETAPAS_SIN_PLAZOS.has(etapa) || !vigente ? null : pendientes[0] ?? null,
    terminos,
  };
}
