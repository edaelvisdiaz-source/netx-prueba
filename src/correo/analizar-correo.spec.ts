import { autenticidadDelRemitente, esRemitenteConfiable, extraerPistas, tituloDesdeAsunto, valoresDeEncabezado } from './analizar-correo';

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

  test('radicado con espacios, puntos o rayas largas entre los grupos', () => {
    expect(extraerPistas('TUTELA 11001 31 03 022 2026 00625 00 ADMITE').completos).toEqual(['11001310302220260062500']);
    expect(extraerPistas('Rad. 11001–31–03–022–2026–00625–00').completos).toEqual(['11001310302220260062500']);
    expect(extraerPistas('Rad: 11001 - 31 - 03 - 022 - 2026 - 00625 - 00').completos).toEqual(['11001310302220260062500']);
    expect(extraerPistas('Exp. 11001.31.03.022.2026.00625.00').completos).toEqual(['11001310302220260062500']);
  });

  test('radicado de 21 digitos, sin el numero de instancia', () => {
    expect(extraerPistas('NOTIFICA AUTO 11001-33-35-012-2026-00441 TUTELA')).toEqual({ completos: [], prefijos: ['110013335012202600441'], anoConsecutivo: [] });
    expect(extraerPistas('Proceso 110013335012202600441.').prefijos).toEqual(['110013335012202600441']);
  });

  test('numero del juzgado abreviado y avisos de SAMAI', () => {
    expect(extraerPistas('FALLO TUTELA 022-2026-00625-00 ACCIONANTE')).toEqual({ completos: [], prefijos: [], anoConsecutivo: ['202600625'] });
    expect(extraerPistas('SAMAI: Notificación RAD 2026-00517-00 Sentencia')).toEqual({ completos: [], prefijos: [], anoConsecutivo: ['202600517'] });
    expect(extraerPistas('TUTELA 2026 – 00517').anoConsecutivo).toEqual(['202600517']);
  });

  test('no confunde fechas, telefonos ni numeros de solicitud con radicados', () => {
    const nada = { completos: [], prefijos: [], anoConsecutivo: [] };
    expect(extraerPistas('Generación de Tutela en línea No 3245678')).toEqual(nada);
    expect(extraerPistas('Audiencia 2026-11-20 10:00, tel 601 3532666 ext 2026')).toEqual(nada);
    expect(extraerPistas('Oficio 2026-EE-426257 del 20-11-2026')).toEqual(nada);
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

  describe('autenticidad del remitente', () => {
    const servidores = ['hostinger.io'];
    const dominios = ['ramajudicial.gov.co', 'notificacionesrj.gov.co'];
    const juzgado = 'j17pccbt@cendoj.ramajudicial.gov.co';
    const veredicto = (encabezados: string[], remitente = juzgado) => autenticidadDelRemitente(encabezados, remitente, servidores, dominios);
    // Formas reales del servidor de correo (partes locales cambiadas).
    const real = 'fr-int-smtpin22.hostinger.io; dkim=pass header.d=cendoj.ramajudicial.gov.co header.s=selector1 header.b="tMAop/Mi"; dmarc=pass (policy=quarantine) header.from=cendoj.ramajudicial.gov.co; spf=pass (fr-int-smtpin22.hostinger.io: domain of xxx@cendoj.ramajudicial.gov.co designates 1.2.3.4 as permitted sender) smtp.mailfrom=xxx@cendoj.ramajudicial.gov.co; arc=pass ("microsoft.com:s=arcselector10001:i=1")';

    test('acepta el correo que el servidor propio comprobo, en cualquier orden de clausulas', () => {
      expect(veredicto([real])).toBe('VERIFICADO');
      expect(veredicto(['de-fra-smtpin7.hostinger.io; arc=pass; spf=pass smtp.mailfrom=x@cendoj.ramajudicial.gov.co; dmarc=pass header.from=ramajudicial.gov.co'])).toBe('VERIFICADO');
      expect(veredicto(['fr-int-smtpin37.hostinger.io; dkim=pass header.d=notificacionesrj.gov.co header.s=sel; dmarc=fail header.from=notificacionesrj.gov.co'], 'samai@notificacionesrj.gov.co')).toBe('VERIFICADO');
    });

    test('rechaza el remitente falsificado', () => {
      // Dice venir del juzgado, pero la firma y el dominio comprobado son de otro.
      expect(veredicto(['fr-int-smtpin1.hostinger.io; dkim=pass header.d=estafa.com; dmarc=fail (policy=quarantine) header.from=cendoj.ramajudicial.gov.co; spf=pass smtp.mailfrom=x@estafa.com'])).toBe('RECHAZADO');
      expect(veredicto(['fr-int-smtpin1.hostinger.io; dkim=none; dmarc=none; spf=softfail smtp.mailfrom=x@cendoj.ramajudicial.gov.co'])).toBe('RECHAZADO');
      // "pass" escondido en un comentario o en otra clave no cuenta.
      expect(veredicto(['fr-int-smtpin1.hostinger.io; dmarc=fail (dmarc=pass header.from=cendoj.ramajudicial.gov.co) header.from=cendoj.ramajudicial.gov.co'])).toBe('RECHAZADO');
      expect(veredicto(['fr-int-smtpin1.hostinger.io; x-dmarc=pass header.from=cendoj.ramajudicial.gov.co'])).toBe('RECHAZADO');
      // Un dominio confiable distinto del que firma no alcanza.
      expect(veredicto(['fr-int-smtpin1.hostinger.io; dkim=pass header.d=notificacionesrj.gov.co'])).toBe('RECHAZADO');
    });

    test('solo vale el veredicto del servidor propio, y el primero', () => {
      expect(veredicto([])).toBe('SIN_DATOS');
      expect(veredicto(['mx.estafa.com; dmarc=pass header.from=cendoj.ramajudicial.gov.co'])).toBe('SIN_DATOS');
      expect(veredicto(['hostinger.io.estafa.com; dmarc=pass header.from=cendoj.ramajudicial.gov.co'])).toBe('SIN_DATOS');
      // El remitente incluyo uno falso con el nombre del servidor propio: queda debajo del real.
      const falso = 'fr-int-smtpin9.hostinger.io; dmarc=pass header.from=cendoj.ramajudicial.gov.co';
      expect(veredicto(['fr-int-smtpin1.hostinger.io; dmarc=fail header.from=cendoj.ramajudicial.gov.co', falso])).toBe('RECHAZADO');
    });

    test('lee encabezados plegados en varias lineas', () => {
      const bloque = 'Return-Path: <x@y.co>\r\nAuthentication-Results: fr-int-smtpin22.hostinger.io;\r\n\tdkim=pass header.d=cendoj.ramajudicial.gov.co;\r\n dmarc=pass header.from=cendoj.ramajudicial.gov.co\r\nARC-Authentication-Results: i=1; otro\r\nauthentication-results: segundo; x=y\r\n';
      const valores = valoresDeEncabezado(bloque, 'Authentication-Results');
      expect(valores).toHaveLength(2);
      expect(veredicto(valores)).toBe('VERIFICADO');
      expect(valoresDeEncabezado('', 'Authentication-Results')).toEqual([]);
    });
  });
});
