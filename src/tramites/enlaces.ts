import { esTipoJudicial, TipoTramite } from './tipos';

export interface EnlaceConsulta {
  readonly nombre: string;
  readonly url: string;
  readonly nota: string;
}

const LARGO_CORPORACION = 7;
/** Sexto y septimo digito del radicado: 33 juzgado administrativo, 23 tribunal administrativo, 03 Consejo de Estado. */
const ENTIDADES_CONTENCIOSO: ReadonlySet<string> = new Set(['33', '23', '03']);

export function esContenciosoAdministrativo(radicado: string): boolean {
  return /^\d{23}$/.test(radicado) && ENTIDADES_CONTENCIOSO.has(radicado.slice(5, LARGO_CORPORACION));
}

/**
 * Paginas oficiales donde una persona puede revisar el tramite. Sirven para la revision asistida
 * de lo que Radika no consulta sola: la ficha de SAMAI pide una verificacion "no soy un robot".
 */
export function enlacesDeConsulta(tipo: TipoTramite, radicado: string): ReadonlyArray<EnlaceConsulta> {
  if (!esTipoJudicial(tipo)) return [];
  const enlaces: EnlaceConsulta[] = [
    {
      nombre: 'Consulta de Procesos de la Rama Judicial',
      url: 'https://consultaprocesos.ramajudicial.gov.co/Procesos/NumeroRadicacion',
      nota: 'Radika la consulta sola. Pega el radicado para verla tu mismo.',
    },
  ];
  if (esContenciosoAdministrativo(radicado)) {
    enlaces.push({
      nombre: 'SAMAI (jurisdiccion contencioso administrativa)',
      url: `https://samai.consejodeestado.gov.co/Vistas/Casos/list_procesos.aspx?guid=${radicado}${radicado.slice(0, LARGO_CORPORACION)}`,
      nota: 'Pide un codigo de verificacion; revisala a mano y registra la actuacion en Radika.',
    });
  }
  return enlaces;
}
