import { calcularSituacion, etapaAutomatica, leerPartes, sentidoDelFallo, terminosVigentes, DatosSituacion } from './situacion';
import { CategoriaActuacion } from './tipos';

const act = (fecha: string, categoria: CategoriaActuacion, titulo = 'Actuacion', anotacion: string | null = null, detectadaAt = new Date('2026-11-01T00:00:00Z')) =>
  ({ fecha, categoria, titulo, anotacion, detectadaAt });

const base: DatosSituacion = {
  tipo: 'TUTELA', estado: 'ACTIVO', clienteNombre: null, sujetos: 'Demandante: VERONICA ANDREA MURILLO AVENDAÑO | Demandado: MINISTERIO DE EDUCACION NACIONAL',
  fechaRadicacion: '2026-11-10', etapaManual: null, etapaManualAt: null, estadoFuente: null, credencialRechazada: false,
  ultimoError: null, erroresConsecutivos: 0, sincronizadoAt: new Date('2026-11-10T00:00:00Z'), createdAt: new Date('2026-11-10T00:00:00Z'),
  fuente: 'RAMA_JUDICIAL_CPNU', actuaciones: [], hoy: '2026-11-12',
};

describe('leerPartes', () => {
  test('separa tutelante y accionado y los deja legibles', () => {
    expect(leerPartes(base.sujetos)).toEqual({ tutelante: 'Veronica Andrea Murillo Avendaño', accionado: 'Ministerio de Educacion Nacional' });
  });

  test('omite el numero de solicitud de la tutela en linea', () => {
    expect(leerPartes('Demandante: TUT4481164 | Demandante: UBALDO ENRIQUE BELTRAN | Demandado: MINISTERIO DE EDUCACION NACIONAL').tutelante).toBe('Ubaldo Enrique Beltran');
    expect(leerPartes('Demandante: Tut 4481164 | Demandado: MEN')).toEqual({ tutelante: null, accionado: 'Men' });
  });

  test('sin sujetos no inventa nombres', () => {
    expect(leerPartes(null)).toEqual({ tutelante: null, accionado: null });
    expect(leerPartes('texto sin formato')).toEqual({ tutelante: null, accionado: null });
  });
});

describe('sentidoDelFallo', () => {
  test.each([
    ['DECLARA CARENCIA OBJETO-ORDENA NOTIFICAR', 'CARENCIA_OBJETO'],
    ['HECHO SUPERADO', 'CARENCIA_OBJETO'],
    ['NIEGA AMPARO', 'FALLO_DESFAVORABLE'],
    ['DECLARA IMPROCEDENTE LA ACCION', 'FALLO_DESFAVORABLE'],
    ['NO CONCEDE TUTELA', 'FALLO_DESFAVORABLE'],
    ['CONCEDE AMPARO - ORDENA RESPONDER', 'FALLO_FAVORABLE'],
    ['TUTELA EL DERECHO DE PETICION', 'FALLO_FAVORABLE'],
    ['ORDENA NOTIFICAR', 'FALLO_SIN_CLASIFICAR'],
  ])('%s -> %s', (anotacion, esperado) => {
    expect(sentidoDelFallo('Sentencia tutela primera instancia', anotacion)).toBe(esperado);
  });
});

describe('etapaAutomatica', () => {
  test('sin actuaciones queda radicada, y sin datos si tampoco hay fecha', () => {
    expect(etapaAutomatica('2026-11-10', [])).toBe('RADICADA');
    expect(etapaAutomatica(null, [])).toBe('SIN_DATOS');
  });

  test('avanza con la ultima actuacion relevante sin importar el orden de llegada', () => {
    const actuaciones = [act('2026-11-19', 'FALLO', 'Sentencia', 'NIEGA'), act('2026-11-10', 'ADMISION'), act('2026-11-18', 'OTRA')];
    expect(etapaAutomatica('2026-11-10', actuaciones)).toBe('FALLO_DESFAVORABLE');
    expect(etapaAutomatica('2026-11-10', [...actuaciones, act('2026-11-20', 'IMPUGNACION')])).toBe('IMPUGNADA');
  });

  test('un requerimiento solo cuenta antes de la admision', () => {
    expect(etapaAutomatica('2026-11-10', [act('2026-11-10', 'REQUERIMIENTO')])).toBe('REQUERIMIENTO');
    expect(etapaAutomatica('2026-11-10', [act('2026-11-10', 'ADMISION'), act('2026-11-12', 'REQUERIMIENTO')])).toBe('ADMITIDA');
  });

  test('con las dos instancias juntas: impugnada al llegar al superior y fallo de segunda cuando decide', () => {
    const primera = [act('2026-05-13', 'ADMISION'), act('2026-05-26', 'FALLO', 'Sentencia', 'CONCEDE')];
    const enTribunal = { ...act('2026-06-01', 'OTRA', 'Reparto y Radicación'), instancia: 1 };
    const falloTribunal = { ...act('2026-07-01', 'FALLO', 'FALLO TUTELA SEGUNDA INSTANCIA', 'SE NIEGA LA PROTECCION'), instancia: 1 };
    expect(etapaAutomatica('2026-05-13', [...primera, enTribunal])).toBe('IMPUGNADA');
    expect(etapaAutomatica('2026-05-13', [...primera, enTribunal, falloTribunal])).toBe('FALLO_SEGUNDA_INSTANCIA');
    const enCorte = { ...act('2026-08-19', 'REMISION_CORTE', 'Envio Corte Constitucional'), instancia: 1 };
    expect(etapaAutomatica('2026-05-13', [...primera, enTribunal, falloTribunal, enCorte])).toBe('EN_CORTE');
  });

  test('desacato y remision a la Corte', () => {
    expect(etapaAutomatica('2026-11-10', [act('2026-11-19', 'FALLO', 'Sentencia', 'CONCEDE'), act('2026-12-01', 'DESACATO')])).toBe('DESACATO');
    expect(etapaAutomatica('2026-11-10', [act('2026-11-19', 'FALLO', 'Sentencia', 'CONCEDE'), act('2026-12-01', 'REMISION_CORTE')])).toBe('EN_CORTE');
  });
});

describe('terminosVigentes', () => {
  const termino = (clave: 'FALLO_PRIMERA_INSTANCIA' | 'IMPUGNACION') =>
    ({ clave, descripcion: '', fechaBase: '2026-11-10', fechaLimite: '2026-11-25', diasHabilesRestantes: 1, estado: 'POR_VENCER' as const });
  const ambos = [termino('FALLO_PRIMERA_INSTANCIA'), termino('IMPUGNACION')];

  test('el plazo del fallo solo importa mientras se espera; el de impugnar, solo si el fallo no fue a favor', () => {
    expect(terminosVigentes('ADMITIDA', ambos).map((t) => t.clave)).toEqual(['FALLO_PRIMERA_INSTANCIA']);
    expect(terminosVigentes('FALLO_DESFAVORABLE', ambos).map((t) => t.clave)).toEqual(['IMPUGNACION']);
    expect(terminosVigentes('CARENCIA_OBJETO', ambos).map((t) => t.clave)).toEqual(['IMPUGNACION']);
    expect(terminosVigentes('FALLO_FAVORABLE', ambos)).toEqual([]);
  });

  test('un caso cumplido, remitido, en segunda instancia o sin etapa no tiene plazos que avisar', () => {
    for (const etapa of ['CUMPLIDA', 'REMITIDA_OTRO_DESPACHO', 'FALLO_SEGUNDA_INSTANCIA', 'EN_CORTE', 'IMPUGNADA'] as const) {
      expect(terminosVigentes(etapa, ambos)).toEqual([]);
    }
    expect(terminosVigentes(null, ambos)).toEqual([]);
  });
});

describe('calcularSituacion', () => {
  test('usa el nombre del cliente si existe y, si no, el tutelante de la fuente', () => {
    expect(calcularSituacion(base).tutelante).toBe('Veronica Andrea Murillo Avendaño');
    expect(calcularSituacion({ ...base, clienteNombre: 'Ana Perez' }).tutelante).toBe('Ana Perez');
  });

  test('carencia de objeto con plazo de impugnacion por vencer es urgente y trae recomendacion', () => {
    const s = calcularSituacion({
      ...base, hoy: '2026-11-23',
      actuaciones: [act('2026-11-10', 'ADMISION'), act('2026-11-19', 'FALLO', 'Sentencia tutela primera Instancia', 'DECLARA CARENCIA OBJETO')],
    });
    expect(s.etapa).toBe('CARENCIA_OBJETO');
    expect(s.nivel).toBe('URGENTE');
    expect(s.atencion[0]).toMatchObject({ nivel: 'URGENTE', fechaLimite: '2026-11-24' });
    expect(s.recomendacion).toContain('impugnar');
    expect(s.ultimaNovedad?.titulo).toBe('Sentencia tutela primera Instancia');
    expect(s.proximoVencimiento).toBe('2026-11-24');
  });

  test('fallo favorable no alerta por impugnacion pero pide verificar cumplimiento', () => {
    const s = calcularSituacion({ ...base, hoy: '2026-11-20', actuaciones: [act('2026-11-19', 'FALLO', 'Sentencia', 'CONCEDE AMPARO')] });
    expect(s.etapa).toBe('FALLO_FAVORABLE');
    expect(s.atencion.map((a) => a.nivel)).toEqual(['PRONTO']);
    expect(s.recomendacion).toContain('cumpl');
  });

  test('casos reales: segunda instancia, cambio de despacho y cumplimiento reportado', () => {
    expect(etapaAutomatica('2026-10-14', [act('2026-10-21', 'FALLO', 'Revoca Tutela')])).toBe('FALLO_SEGUNDA_INSTANCIA');
    expect(etapaAutomatica('2026-10-23', [act('2026-10-23', 'OTRA', 'Que ordena remitir', 'REMITE POR COMPETENCIA - ORDENA NOTIFICAR')])).toBe('REMITIDA_OTRO_DESPACHO');
    expect(etapaAutomatica('2026-10-13', [act('2026-10-27', 'FALLO', 'Sentencia tutela primera Instancia'), act('2026-11-03', 'OTRA', 'Recepción memorial', 'CUMPLIMIENTO MINISTERIO EDUCACION')])).toBe('FALLO_FAVORABLE');
    const remitida = calcularSituacion({ ...base, hoy: '2026-12-01', actuaciones: [act('2026-11-10', 'OTRA', 'Que ordena remitir', 'REMITE POR COMPETENCIA')] });
    expect(remitida).toMatchObject({ nivel: 'PRONTO', proximoVencimiento: null });
    const sinMovimiento = calcularSituacion({ ...base, hoy: '2026-12-01' });
    expect(sinMovimiento.atencion[0]).toMatchObject({ nivel: 'PRONTO' });
    expect(sinMovimiento.atencion[0].motivo).toContain('puede no estar actualizada');
  });

  test('el juez no ha fallado y el plazo vencio', () => {
    const s = calcularSituacion({ ...base, hoy: '2026-12-01', actuaciones: [act('2026-11-10', 'ADMISION')] });
    expect(s.etapa).toBe('ADMITIDA');
    expect(s.nivel).toBe('URGENTE');
    expect(s.atencion[0].motivo).toContain('no ha fallado');
  });

  test('admitida y dentro del plazo no requiere atencion', () => {
    const s = calcularSituacion({ ...base, actuaciones: [act('2026-11-10', 'ADMISION')] });
    expect(s.atencion).toEqual([]);
    expect(s.nivel).toBeNull();
    expect(s.proximoVencimiento).toBe('2026-11-25');
  });

  test('la etapa manual manda y avisa si despues llega una novedad distinta', () => {
    const manual = { ...base, etapaManual: 'CUMPLIDA' as const, etapaManualAt: new Date('2026-11-20T00:00:00Z'), hoy: '2026-12-10' };
    const fallo = act('2026-11-19', 'FALLO', 'Sentencia', 'CONCEDE');
    const quieta = calcularSituacion({ ...manual, actuaciones: [fallo] });
    expect(quieta).toMatchObject({ etapa: 'CUMPLIDA', etapaAutomatica: 'FALLO_FAVORABLE', esManual: true, atencion: [] });

    const conNovedad = calcularSituacion({ ...manual, actuaciones: [fallo, act('2026-12-05', 'DESACATO', 'Abre desacato', null, new Date('2026-12-05T12:00:00Z'))] });
    expect(conNovedad.atencion[0]).toMatchObject({ nivel: 'PRONTO' });
    expect(conNovedad.atencion[0].motivo).toContain('cambio manual');
  });

  test('un tramite cerrado o pausado no genera alertas ni vencimientos', () => {
    const s = calcularSituacion({ ...base, estado: 'CERRADO', hoy: '2026-12-01', credencialRechazada: true, actuaciones: [act('2026-11-10', 'ADMISION')] });
    expect(s).toMatchObject({ etapa: 'ADMITIDA', atencion: [], nivel: null, proximoVencimiento: null });
  });

  test('requerimiento del juzgado es urgente', () => {
    const s = calcularSituacion({ ...base, actuaciones: [act('2026-11-11', 'REQUERIMIENTO', 'Auto inadmite')] });
    expect(s.nivel).toBe('URGENTE');
  });

  test('avisa cuando el tramite no aparece en la fuente o no se puede consultar', () => {
    const sinAparecer = calcularSituacion({ ...base, fechaRadicacion: null, sincronizadoAt: null, createdAt: new Date('2026-11-01T00:00:00Z') });
    expect(sinAparecer.atencion[0]).toMatchObject({ nivel: 'INFO' });
    expect(sinAparecer.etapa).toBe('SIN_DATOS');
    const conError = calcularSituacion({ ...base, ultimoError: 'La fuente no responde', erroresConsecutivos: 3 });
    expect(conError.atencion.some((a) => a.motivo.includes('no ha podido'))).toBe(true);
  });

  test('tramite de portal: muestra el estado de la plataforma y la clave rechazada', () => {
    const s = calcularSituacion({ ...base, tipo: 'CONVALIDACION_MEN', fuente: 'MEN_CONVALIDACION', sujetos: null, estadoFuente: 'En evaluacion', credencialRechazada: true });
    expect(s.etapa).toBeNull();
    expect(s.nota).toContain('En evaluacion');
    expect(s.nivel).toBe('URGENTE');
  });
});
