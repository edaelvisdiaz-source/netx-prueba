import { esRemitenteConfiable, extraerPistas, tituloDesdeAsunto } from './analizar-correo';

/** Asuntos reales recibidos de juzgados (nombres de personas cambiados). */
describe('correos de juzgados', () => {
  test('radicado completo en el asunto', () => {
    const pistas = extraerPistas('RE: Solicitud urgente de información, expediente digital y fallo – Acción de Tutela Rad. 11001311002020260077500');
    expect(pistas).toEqual({ completos: ['11001311002020260077500'], prefijos: [], anoConsecutivo: [] });
  });

  test('despacho, ano y consecutivo separados', () => {
    const pistas = extraerPistas('NOTIFICA FALLO TUTELA 110013109017-2026 - 9795 Accionante: PERSONA DE EJEMPLO');
    expect(pistas).toEqual({ completos: [], prefijos: ['110013109017202609795'], anoConsecutivo: [] });
  });

  test('radicado completo junto a un numero interno del juzgado', () => {
    const pistas = extraerPistas('RV: 08638318400120260053700.- REMITE TUTELA 2026-10254');
    expect(pistas).toEqual({ completos: ['08638318400120260053700'], prefijos: [], anoConsecutivo: ['202610254'] });
  });

  test('radicado con guiones y sin pistas', () => {
    expect(extraerPistas('Rad. 11001-31-03-056-2026-00052-00 auto').completos).toEqual(['11001310305620260005200']);
    expect(extraerPistas('Buenas tardes, adjunto lo solicitado')).toEqual({ completos: [], prefijos: [], anoConsecutivo: [] });
    expect(extraerPistas('Celular 3001234567 y fecha 2026-11-20')).toEqual({ completos: [], prefijos: [], anoConsecutivo: [] });
  });

  test('titulo sin prefijos de respuesta', () => {
    expect(tituloDesdeAsunto('RE: RV:  NOTIFICA  AUTO AVOCA TUTELA')).toBe('NOTIFICA AUTO AVOCA TUTELA');
    expect(tituloDesdeAsunto('RE: ')).toBe('Correo del despacho');
    expect(tituloDesdeAsunto('x'.repeat(300))).toHaveLength(200);
  });

  test('solo acepta remitentes de dominios judiciales', () => {
    const dominios = ['ramajudicial.gov.co', 'consejodeestado.gov.co'];
    expect(esRemitenteConfiable('j17pccbt@cendoj.ramajudicial.gov.co', dominios)).toBe(true);
    expect(esRemitenteConfiable('X@RAMAJUDICIAL.GOV.CO', dominios)).toBe(true);
    expect(esRemitenteConfiable('juez@ramajudicial.gov.co.estafa.com', dominios)).toBe(false);
    expect(esRemitenteConfiable('juez@falsoramajudicial.gov.co', dominios)).toBe(false);
    expect(esRemitenteConfiable('sin-arroba', dominios)).toBe(false);
  });
});
