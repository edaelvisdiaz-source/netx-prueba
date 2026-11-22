import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { BovedaService, CredencialPortal } from '../src/boveda/boveda.service';
import { ENV, Env } from '../src/config/env';
import { BuzonService } from '../src/correo/buzon.service';
import { CorreoLeido, LectorBuzon, LecturaBuzon } from '../src/correo/lector-buzon';
import { ActuacionFuente, Fuente, FuenteError, ProcesoFuente } from '../src/fuentes/fuente';
import { EstadoPortal, FuentePortal, PORTALES, PortalError } from '../src/fuentes/fuente-portal';
import { RamaJudicialFuente } from '../src/fuentes/rama-judicial.fuente';
import { MonitorService } from '../src/monitor/monitor.service';
import { Planificador } from '../src/monitor/planificador';
import { EventosService, firmar } from '../src/notificaciones/eventos.service';
import { EntradaResumen, ResumenActuacion, Resumidor } from '../src/resumen/resumidor';
import { sumarDiasHabiles } from '../src/terminos/dias-habiles';

const LLAVE = 'llave-de-prueba-'.padEnd(40, 'x');
const SECRETO = 'secreto-de-prueba-'.padEnd(40, 'y');
const RADICADO = '11001310300120260012300';

class FuenteFalsa extends Fuente {
  readonly id = 'RAMA_JUDICIAL_CPNU' as const;
  procesos: ProcesoFuente[] = [];
  actuaciones: ActuacionFuente[] = [];
  fallo: FuenteError | null = null;

  async buscarProcesos(): Promise<ProcesoFuente[]> {
    if (this.fallo) throw this.fallo;
    return this.procesos;
  }

  async listarActuaciones(): Promise<ActuacionFuente[]> {
    return this.actuaciones;
  }
}

class ResumidorFalso extends Resumidor {
  activo = false;
  pedidos: EntradaResumen[] = [];

  async resumir(entrada: EntradaResumen): Promise<ResumenActuacion | null> {
    if (!this.activo) return null;
    this.pedidos.push(entrada);
    if (entrada.titulo === 'Traslado') return null;
    return { resumen: `Resumen de ${entrada.titulo}`, queSignifica: 'x', accionSugerida: 'y', urgencia: 'MEDIA' };
  }
}

class PortalFalso extends FuentePortal {
  readonly id = 'MEN_CONVALIDACION' as const;
  estado: EstadoPortal = { estado: 'Radicado', detalle: null };
  fallo: PortalError | null = null;
  recibidas: Array<CredencialPortal & { radicado: string }> = [];

  async consultarEstado(credencial: CredencialPortal, radicado: string): Promise<EstadoPortal> {
    this.recibidas.push({ ...credencial, radicado });
    if (this.fallo) throw this.fallo;
    return this.estado;
  }
}

class LectorFalso extends LectorBuzon {
  buzon: string | null = 'asesor@empresa.test';
  uidValidity = '1';
  correos: CorreoLeido[] = [];

  async leerDesde(ultimoUid: number, maximo: number): Promise<LecturaBuzon> {
    const uidMaximo = this.correos.reduce((mayor, correo) => Math.max(mayor, correo.uid), 0);
    return {
      uidValidity: this.uidValidity,
      uidMaximo,
      correos: this.correos.filter((correo) => correo.uid > ultimoUid && correo.uid <= ultimoUid + maximo),
    };
  }
}

const proceso = (fechaRadicacion: string): ProcesoFuente => ({
  idFuente: '77', despacho: 'JUZGADO 5 CIVIL', sujetos: 'Accionante: A | Accionado: MEN', fechaRadicacion, privado: false,
});
const actuacion = (clave: string, fecha: string, titulo: string): ActuacionFuente => ({
  clave, fecha, titulo, anotacion: null, fechaInicioTermino: null, fechaFinTermino: null, fechaRegistro: fecha,
});

function leerCuerpo(peticion: IncomingMessage): Promise<string> {
  return new Promise((resolver) => {
    let cuerpo = '';
    peticion.on('data', (parte) => (cuerpo += parte));
    peticion.on('end', () => resolver(cuerpo));
  });
}

describe('Radika API', () => {
  let app: INestApplication;
  let datos: DataSource;
  let crm: Server;
  const fuente = new FuenteFalsa();
  const resumidor = new ResumidorFalso();
  const lector = new LectorFalso();
  const portal = new PortalFalso();
  const recibidos: Array<{ cuerpo: string; firma: string; marca: string }> = [];
  let estadoCrm = 200;

  const api = () => request(app.getHttpServer());
  const conLlave = (peticion: request.Test) => peticion.set('x-api-key', LLAVE);
  const crearTutela = async (radicado = RADICADO) =>
    (await conLlave(api().post('/v1/tramites')).send({ tipo: 'TUTELA', radicado, referenciaCrm: 'E4MXO9T4' })).body.data;

  beforeAll(async () => {
    crm = createServer(async (peticion, respuesta) => {
      recibidos.push({
        cuerpo: await leerCuerpo(peticion),
        firma: String(peticion.headers['x-radika-signature']),
        marca: String(peticion.headers['x-radika-timestamp']),
      });
      respuesta.statusCode = estadoCrm;
      respuesta.end();
    });
    await new Promise<void>((resolver) => crm.listen(0, '127.0.0.1', resolver));
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://radika:radika_local@127.0.0.1:5432/radika_test',
      RADIKA_API_KEYS: LLAVE,
      CRM_WEBHOOK_URL: `http://127.0.0.1:${(crm.address() as AddressInfo).port}/hook`,
      CRM_WEBHOOK_SECRET: SECRETO,
      SCHEDULER_ENABLED: 'false',
      ANTHROPIC_API_KEY: '',
      CREDENCIALES_LLAVE: Buffer.alloc(32, 7).toString('base64'),
      REVISION_LOTE: '10',
    });
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RamaJudicialFuente)
      .useValue(fuente)
      .overrideProvider(Resumidor)
      .useValue(resumidor)
      .overrideProvider(LectorBuzon)
      .useValue(lector)
      .overrideProvider(PORTALES)
      .useValue([portal])
      .compile();
    app = modulo.createNestApplication();
    await app.init();
    datos = app.get(DataSource);
  });

  beforeEach(async () => {
    await datos.query('TRUNCATE eventos, actuaciones, tramites, buzones, correos_pendientes, credenciales, accesos_portal');
    portal.estado = { estado: 'Radicado', detalle: null };
    portal.fallo = null;
    portal.recibidas = [];
    lector.buzon = 'asesor@empresa.test';
    lector.uidValidity = '1';
    lector.correos = [];
    fuente.procesos = [];
    fuente.actuaciones = [];
    fuente.fallo = null;
    resumidor.activo = false;
    resumidor.pedidos = [];
    recibidos.length = 0;
    estadoCrm = 200;
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolver) => crm.close(resolver));
  });

  test('la salud es publica y el resto exige llave', async () => {
    await api().get('/health').expect(200, { success: true, data: { estado: 'ok' }, error: null });
    const sinLlave = await api().get('/v1/tramites').expect(401);
    expect(sinLlave.body).toMatchObject({ success: false, data: null, error: { code: 'UNAUTHORIZED' } });
    await api().get('/v1/tramites').set('x-api-key', 'otra-llave').expect(401);
    const consulta = jest.spyOn(datos, 'query').mockRejectedValueOnce(new Error('sin conexion'));
    const caida = await api().get('/health').expect(503);
    expect(caida.body).toMatchObject({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    consulta.mockRestore();
  });

  test('valida los datos al crear un tramite', async () => {
    const corto = await conLlave(api().post('/v1/tramites')).send({ tipo: 'TUTELA', radicado: '123' }).expect(400);
    expect(corto.body.error.message).toMatch(/23 digitos/);
    const extra = await conLlave(api().post('/v1/tramites')).send({ tipo: 'TUTELA', radicado: RADICADO, clave: 'x' }).expect(400);
    expect(extra.body.error.details).toBeDefined();
    await conLlave(api().post('/v1/tramites'))
      .send({ tipo: 'APOSTILLA', radicado: 'AP-1', fuente: 'RAMA_JUDICIAL_CPNU' })
      .expect(400);
    await conLlave(api().post('/v1/tramites')).send({ tipo: 'APOSTILLA', radicado: '<x>' }).expect(400);
  });

  test('registra tramites judiciales y manuales, y no repite radicados', async () => {
    const tutela = await crearTutela('11001-31-03-001-2026-00123-00');
    expect(tutela).toMatchObject({ radicado: RADICADO, fuente: 'RAMA_JUDICIAL_CPNU', estado: 'ACTIVO' });
    await conLlave(api().post('/v1/tramites')).send({ tipo: 'TUTELA', radicado: RADICADO }).expect(409);
    const manual = await conLlave(api().post('/v1/tramites'))
      .send({ tipo: 'CONVALIDACION_MEN', radicado: '2026-ER-555', clienteNombre: 'Ana Perez' })
      .expect(201);
    expect(manual.body.data.fuente).toBe('MANUAL');
    await conLlave(api().post(`/v1/tramites/${manual.body.data.id}/revisar`)).expect(400);
  });

  test('sincroniza, detecta actuaciones nuevas y calcula terminos', async () => {
    const tutela = await crearTutela();
    const revisar = () => conLlave(api().post(`/v1/tramites/${tutela.id}/revisar`)).expect(200);

    expect((await revisar()).body.data).toMatchObject({ encontrado: false, actuacionesNuevas: 0, error: null });

    fuente.procesos = [proceso('2026-11-03'), { ...proceso('2026-11-04'), idFuente: '78', privado: true }];
    fuente.actuaciones = [actuacion('1', '2026-11-03', 'Radicacion'), actuacion('2', '2026-11-04', 'Auto admite tutela')];
    expect((await revisar()).body.data).toMatchObject({ encontrado: true, primeraSincronizacion: true, actuacionesNuevas: 2 });

    fuente.actuaciones = [...fuente.actuaciones, actuacion('3', '2026-11-17', 'Sentencia de primera instancia')];
    expect((await revisar()).body.data).toMatchObject({ primeraSincronizacion: false, actuacionesNuevas: 1 });
    expect((await revisar()).body.data.actuacionesNuevas).toBe(0);

    const detalle = (await conLlave(api().get(`/v1/tramites/${tutela.id}`)).expect(200)).body.data;
    expect(detalle.tramite).toMatchObject({
      despacho: 'JUZGADO 5 CIVIL', fechaRadicacion: '2026-11-03', ultimaActuacionFecha: '2026-11-17',
      ultimoError: null, erroresConsecutivos: 0,
    });
    expect(detalle.actuaciones.map((item: { categoria: string }) => item.categoria)).toEqual(['FALLO', 'ADMISION', 'OTRA']);
    expect(detalle.terminos.map((termino: { clave: string; estado: string }) => [termino.clave, termino.estado])).toEqual([
      ['FALLO_PRIMERA_INSTANCIA', 'CUMPLIDO'],
      ['IMPUGNACION', expect.any(String)],
    ]);

    const eventos = (await conLlave(api().get('/v1/eventos')).expect(200)).body.data.eventos;
    expect(eventos.map((evento: { tipo: string }) => evento.tipo)).toEqual(['TRAMITE_SINCRONIZADO', 'ACTUACION_NUEVA']);
    expect(eventos[1].payload).toMatchObject({
      tramite: { referenciaCrm: 'E4MXO9T4', radicado: RADICADO },
      datos: { actuacion: { categoria: 'FALLO' }, notaSugerida: expect.stringContaining('Sentencia') },
    });
  });

  test('entrega los avisos al CRM firmados y reintenta si falla', async () => {
    const tutela = await crearTutela();
    fuente.procesos = [proceso('2026-11-03')];
    fuente.actuaciones = [actuacion('1', '2026-11-03', 'Radicacion')];
    await app.get(MonitorService).revisar(tutela.id);
    const eventos = app.get(EventosService);

    estadoCrm = 500;
    expect(await eventos.entregarPendientes()).toBe(0);
    const [fallido] = await datos.query('SELECT estado, intentos, proximo_intento_at > now() AS despues FROM eventos');
    expect(fallido).toEqual({ estado: 'PENDIENTE', intentos: 1, despues: true });
    expect(await eventos.entregarPendientes()).toBe(0);
    expect(recibidos).toHaveLength(1);

    estadoCrm = 200;
    await datos.query('UPDATE eventos SET proximo_intento_at = now()');
    expect(await eventos.entregarPendientes()).toBe(1);
    const entrega = recibidos[1];
    expect(entrega.firma).toBe(firmar(SECRETO, entrega.marca, entrega.cuerpo));
    expect(JSON.parse(entrega.cuerpo)).toMatchObject({ tipo: 'TRAMITE_SINCRONIZADO', tramite: { id: tutela.id } });
    const [entregado] = await datos.query('SELECT estado, intentos FROM eventos');
    expect(entregado).toEqual({ estado: 'ENTREGADO', intentos: 2 });
  });

  test('marca fallido tras agotar intentos y no envia si el CRM no esta configurado', async () => {
    const tutela = await crearTutela();
    fuente.procesos = [proceso('2026-11-03')];
    await app.get(MonitorService).revisar(tutela.id);
    await datos.query('UPDATE eventos SET intentos = 7');
    estadoCrm = 500;
    await app.get(EventosService).entregarPendientes();
    expect((await datos.query('SELECT estado FROM eventos'))[0].estado).toBe('FALLIDO');
    const reintento = await conLlave(api().post('/v1/eventos/reintentar')).expect(200);
    expect(reintento.body.data).toEqual({ reencolados: 1 });
    expect(await datos.query('SELECT estado, intentos FROM eventos')).toEqual([{ estado: 'PENDIENTE', intentos: 0 }]);

    const env = app.get<Env>(ENV);
    const sinCrm = new EventosService(datos.getRepository('Evento') as never, { ...env, CRM_WEBHOOK_URL: undefined }, fetch);
    expect(await sinCrm.entregarPendientes()).toBe(0);
    const caido = new EventosService(datos.getRepository('Evento') as never, { ...env, CRM_WEBHOOK_URL: 'http://127.0.0.1:1/x' }, fetch);
    expect(await caido.entregarPendientes()).toBe(0);
  });

  test('registra los errores de la fuente y avisa al quinto seguido', async () => {
    const tutela = await crearTutela();
    fuente.fallo = new FuenteError('La Rama Judicial respondio 503', 'NO_DISPONIBLE');
    for (let intento = 1; intento <= 5; intento += 1) {
      const resultado = await app.get(MonitorService).revisar(tutela.id);
      expect(resultado.error).toMatch(/503/);
    }
    const detalle = (await conLlave(api().get(`/v1/tramites/${tutela.id}`))).body.data.tramite;
    expect(detalle).toMatchObject({ erroresConsecutivos: 5, ultimoError: 'La Rama Judicial respondio 503' });
    const eventos = await datos.query('SELECT tipo FROM eventos');
    expect(eventos).toEqual([{ tipo: 'ERROR_FUENTE' }]);
  });

  test('la revision automatica toma solo los tramites activos que ya tocan', async () => {
    const activa = await crearTutela();
    const pausada = await crearTutela('11001310300120260012301');
    const futura = await crearTutela('11001310300120260012302');
    await conLlave(api().patch(`/v1/tramites/${pausada.id}`)).send({ estado: 'PAUSADO' }).expect(200);
    await datos.query(`UPDATE tramites SET proxima_revision_at = now() + interval '1 day' WHERE id = $1`, [futura.id]);
    await conLlave(api().post('/v1/tramites')).send({ tipo: 'APOSTILLA', radicado: 'AP-9' }).expect(201);
    fuente.procesos = [proceso('2026-11-03')];

    const monitor = app.get(MonitorService);
    expect(await monitor.revisarPendientes()).toBe(1);
    expect(await monitor.revisarPendientes()).toBe(0);
    const filas = await datos.query('SELECT id FROM tramites WHERE sincronizado_at IS NOT NULL');
    expect(filas).toEqual([{ id: activa.id }]);

    const reactivada = await conLlave(api().patch(`/v1/tramites/${pausada.id}`)).send({ estado: 'ACTIVO' }).expect(200);
    expect(reactivada.body.data.estado).toBe('ACTIVO');
    expect(await monitor.revisarPendientes()).toBe(1);
  });

  test('avisa una sola vez cuando un termino de tutela vence o esta por vencer', async () => {
    const tutela = await crearTutela();
    fuente.procesos = [proceso('2026-11-03')];
    fuente.actuaciones = [actuacion('1', '2026-11-04', 'Auto admite tutela')];
    await app.get(MonitorService).revisar(tutela.id);
    await datos.query('DELETE FROM eventos');
    const monitor = app.get(MonitorService);
    const limite = sumarDiasHabiles('2026-11-03', 10);

    expect(await monitor.avisarTerminos('2026-11-05')).toBe(0);
    expect(await monitor.avisarTerminos(limite)).toBe(1);
    expect(await monitor.avisarTerminos(limite)).toBe(0);
    expect(await monitor.avisarTerminos(sumarDiasHabiles(limite, 1))).toBe(1);
    const eventos = await datos.query('SELECT tipo FROM eventos ORDER BY created_at');
    expect(eventos).toEqual([{ tipo: 'TERMINO_POR_VENCER' }, { tipo: 'TERMINO_VENCIDO' }]);

    await datos.query('TRUNCATE eventos, actuaciones, tramites CASCADE');
    expect(await monitor.avisarTerminos(limite)).toBe(0);
  });

  test('lista con filtros y paginas, actualiza y elimina', async () => {
    const primera = await crearTutela();
    await crearTutela('11001310300120260012301');
    await conLlave(api().post('/v1/tramites')).send({ tipo: 'APOSTILLA', radicado: 'AP-1', referenciaCrm: 'K28PL4MX' }).expect(201);

    const pagina = (await conLlave(api().get('/v1/tramites?tipo=TUTELA&limit=1&page=2')).expect(200)).body;
    expect(pagina.meta).toEqual({ total: 2, page: 2, limit: 1 });
    expect(pagina.data).toHaveLength(1);
    const porVenta = (await conLlave(api().get('/v1/tramites?referenciaCrm=K28PL4MX&estado=ACTIVO'))).body;
    expect(porVenta.data).toHaveLength(1);
    await conLlave(api().get('/v1/tramites?limit=500')).expect(400);

    const cambio = await conLlave(api().patch(`/v1/tramites/${primera.id}`)).send({ clienteNombre: 'Ana', referenciaCrm: null }).expect(200);
    expect(cambio.body.data).toMatchObject({ clienteNombre: 'Ana', referenciaCrm: null });
    await conLlave(api().patch(`/v1/tramites/${primera.id}`)).send({}).expect(400);

    await conLlave(api().delete(`/v1/tramites/${primera.id}`)).expect(200);
    await conLlave(api().delete(`/v1/tramites/${primera.id}`)).expect(404);
    await conLlave(api().get(`/v1/tramites/${primera.id}`)).expect(404);
    await conLlave(api().get('/v1/tramites/no-es-uuid')).expect(400);
  });

  test('los eventos se pueden recorrer por paginas con cursor', async () => {
    const tutela = await crearTutela();
    fuente.procesos = [proceso('2026-11-03')];
    await app.get(MonitorService).revisar(tutela.id);
    fuente.actuaciones = [actuacion('1', '2026-11-04', 'Auto admite'), actuacion('2', '2026-11-05', 'Traslado')];
    await app.get(MonitorService).revisar(tutela.id);

    const primera = (await conLlave(api().get('/v1/eventos?limit=2')).expect(200)).body.data;
    expect(primera.eventos).toHaveLength(2);
    const segunda = (await conLlave(api().get(`/v1/eventos?limit=2&cursor=${encodeURIComponent(primera.siguiente)}`)).expect(200)).body.data;
    expect(segunda.eventos).toHaveLength(1);
    const vacia = (await conLlave(api().get(`/v1/eventos?cursor=${encodeURIComponent(segunda.siguiente)}`))).body.data;
    expect(vacia).toEqual({ eventos: [], siguiente: null });
    await conLlave(api().get('/v1/eventos?cursor=malo')).expect(400);
  });

  test('no duplica avisos si dos revisiones coinciden y reporta los procesos reservados', async () => {
    const tutela = await crearTutela();
    fuente.procesos = [proceso('2026-11-03')];
    fuente.actuaciones = [actuacion('1', '2026-11-03', 'Radicacion')];
    const monitor = app.get(MonitorService);
    await Promise.all([monitor.revisar(tutela.id), monitor.revisar(tutela.id)]);
    expect(await datos.query('SELECT tipo FROM eventos')).toEqual([{ tipo: 'TRAMITE_SINCRONIZADO' }]);
    expect(await datos.query('SELECT count(*)::int AS n FROM actuaciones')).toEqual([{ n: 1 }]);

    const eventos = app.get(EventosService);
    const entregas = await Promise.all([eventos.entregarPendientes(), eventos.entregarPendientes()]);
    expect(entregas[0] + entregas[1]).toBe(1);
    expect(recibidos).toHaveLength(1);

    const reservada = await crearTutela('11001310300120260012305');
    fuente.procesos = [{ ...proceso('2026-11-03'), privado: true }];
    await monitor.revisar(reservada.id);
    const detalle = (await conLlave(api().get(`/v1/tramites/${reservada.id}`))).body.data.tramite;
    expect(detalle.ultimoError).toMatch(/reservado/);
  });

  test('resume solo las novedades y las incluye en el aviso', async () => {
    resumidor.activo = true;
    const tutela = await crearTutela();
    const monitor = app.get(MonitorService);
    fuente.procesos = [proceso('2026-11-03')];
    fuente.actuaciones = [actuacion('1', '2026-11-03', 'Radicacion'), actuacion('2', '2026-11-04', 'Auto admite tutela')];
    await monitor.revisar(tutela.id);
    expect(resumidor.pedidos).toHaveLength(0);

    fuente.actuaciones = [
      ...fuente.actuaciones,
      actuacion('4', '2026-11-17', 'Sentencia de primera instancia'),
      actuacion('3', '2026-11-10', 'Traslado'),
    ];
    await monitor.revisar(tutela.id);
    expect(resumidor.pedidos.map((pedido) => pedido.titulo)).toEqual(['Traslado', 'Sentencia de primera instancia']);
    expect(resumidor.pedidos[1].anteriores.map((anterior) => anterior.titulo)).toEqual(['Traslado', 'Auto admite tutela', 'Radicacion']);
    expect(resumidor.pedidos[1]).toMatchObject({ tipoTramite: 'TUTELA', categoria: 'FALLO', despacho: 'JUZGADO 5 CIVIL' });

    const guardadas = await datos.query(`SELECT titulo, resumen->>'resumen' AS resumen FROM actuaciones ORDER BY fecha`);
    expect(guardadas.map((fila: { resumen: string | null }) => fila.resumen)).toEqual([
      null, null, null, 'Resumen de Sentencia de primera instancia',
    ]);
    const avisos = await datos.query(`SELECT payload FROM eventos WHERE tipo = 'ACTUACION_NUEVA' ORDER BY payload->'datos'->'actuacion'->>'fecha'`);
    expect(avisos[0].payload.datos).toMatchObject({ resumen: null, notaSugerida: expect.stringContaining('Traslado') });
    expect(avisos[1].payload.datos).toMatchObject({
      resumen: { urgencia: 'MEDIA' },
      notaSugerida: 'Radika: Resumen de Sentencia de primera instancia',
    });
  });

  test('permite registrar a mano lo que no tiene consulta automatica y da los enlaces oficiales', async () => {
    resumidor.activo = true;
    const convalidacion = (
      await conLlave(api().post('/v1/tramites')).send({ tipo: 'CONVALIDACION_MEN', radicado: '2026-ER-777', referenciaCrm: 'J75QU6YR' })
    ).body.data;
    const creada = await conLlave(api().post(`/v1/tramites/${convalidacion.id}/actuaciones`))
      .send({ fecha: '2026-11-20', titulo: 'Requerimiento de documentos', anotacion: 'Falta el acta de grado' })
      .expect(201);
    expect(creada.body.data).toMatchObject({ categoria: 'REQUERIMIENTO', resumen: { urgencia: 'MEDIA' } });
    const detalle = (await conLlave(api().get(`/v1/tramites/${convalidacion.id}`))).body.data;
    expect(detalle).toMatchObject({ tramite: { ultimaActuacionFecha: '2026-11-20' }, enlacesConsulta: [] });
    expect(detalle.actuaciones).toHaveLength(1);
    const [aviso] = await datos.query('SELECT tipo, payload FROM eventos');
    expect(aviso).toMatchObject({
      tipo: 'ACTUACION_NUEVA',
      payload: { tramite: { referenciaCrm: 'J75QU6YR' }, datos: { origen: 'MANUAL', notaSugerida: 'Radika: Resumen de Requerimiento de documentos' } },
    });
    await conLlave(api().post(`/v1/tramites/${convalidacion.id}/actuaciones`)).send({ fecha: '2026-02-31', titulo: 'x' }).expect(400);
    await conLlave(api().post(`/v1/tramites/${convalidacion.id}/actuaciones`)).send({ fecha: '2026-11-20' }).expect(400);

    const administrativa = await crearTutela('11001333400120260012300');
    const enlaces = (await conLlave(api().get(`/v1/tramites/${administrativa.id}`))).body.data.enlacesConsulta;
    expect(enlaces.map((enlace: { url: string }) => enlace.url)).toEqual([
      'https://consultaprocesos.ramajudicial.gov.co/Procesos/NumeroRadicacion',
      'https://samai.consejodeestado.gov.co/Vistas/Casos/list_procesos.aspx?guid=110013334001202600123001100133',
    ]);
    const civil = await crearTutela();
    expect((await conLlave(api().get(`/v1/tramites/${civil.id}`))).body.data.enlacesConsulta).toHaveLength(1);
  });

  test('convierte los correos de los juzgados en actuaciones del tramite correcto', async () => {
    const correo = (asunto: string, extra: Record<string, unknown> = {}) =>
      conLlave(api().post('/v1/correos')).send({
        messageId: `<${asunto.length}-${Object.keys(extra).length}@exchangelabs.com>`,
        from: 'j17pccbt@cendoj.ramajudicial.gov.co',
        fromNombre: 'Juzgado 17 Penal Circuito Conocimiento - Bogotá',
        subject: asunto,
        date: '2026-11-11T21:54:06Z',
        ...extra,
      });
    const penal = await crearTutela('11001310901720260979500');
    const familia = await crearTutela('11001311002020260077500');

    const fallo = await correo('NOTIFICA FALLO TUTELA 110013109017-2026 - 9795 Accionante: PERSONA DE EJEMPLO', {
      adjuntos: ['10. Fallo de tutela 9795. Hecho superado.pdf'],
    }).expect(200);
    expect(fallo.body.data).toEqual({ vinculado: true, tramiteId: penal.id, duplicado: false });
    const repetido = await correo('NOTIFICA FALLO TUTELA 110013109017-2026 - 9795 Accionante: PERSONA DE EJEMPLO', {
      adjuntos: ['10. Fallo de tutela 9795. Hecho superado.pdf'],
    });
    expect(repetido.body.data).toMatchObject({ vinculado: true, duplicado: true });

    const respuesta = await correo('RE: Solicitud urgente de información – Acción de Tutela Rad. 11001311002020260077500');
    expect(respuesta.body.data).toMatchObject({ vinculado: true, tramiteId: familia.id });
    const porTexto = await correo('NOTIFICA AUTO', { texto: 'Tutela 2026-09795 en este despacho' });
    expect(porTexto.body.data).toMatchObject({ vinculado: true, tramiteId: penal.id });

    const detalle = (await conLlave(api().get(`/v1/tramites/${penal.id}`))).body.data;
    const porCategoria = Object.fromEntries(
      detalle.actuaciones.map((item: { categoria: string; fecha: string; anotacion: string }) => [item.categoria, item]),
    );
    expect(Object.keys(porCategoria).sort()).toEqual(['FALLO', 'OTRA']);
    expect(porCategoria.FALLO).toMatchObject({ fecha: '2026-11-11', despacho: 'Juzgado 17 Penal Circuito Conocimiento - Bogotá' });
    expect(porCategoria.FALLO.anotacion).toContain('Hecho superado.pdf');
    const avisos = await datos.query(`SELECT payload->'datos'->>'origen' AS origen FROM eventos`);
    expect(avisos).toEqual([{ origen: 'CORREO' }, { origen: 'CORREO' }, { origen: 'CORREO' }]);

    await crearTutela('05001310901720260979500');
    expect((await correo('Tutela 2026-09795 nueva actuacion', { texto: 'x' })).body.data).toEqual({ vinculado: false, motivo: 'AMBIGUO' });
    expect((await correo('Cordial saludo')).body.data).toEqual({ vinculado: false, motivo: 'SIN_RADICADO' });
    expect((await correo('Rad. 76001310300120260000100')).body.data).toEqual({ vinculado: false, motivo: 'SIN_TRAMITE' });
    const falso = await correo('NOTIFICA FALLO 11001311002020260077500', { from: 'juez@ramajudicial.gov.co.estafa.com' });
    expect(falso.body.data).toEqual({ vinculado: false, motivo: 'REMITENTE_NO_CONFIABLE' });
    await correo('x', { date: 'ayer' }).expect(400);
  });

  test('vigila el buzon: parte del presente, enlaza lo que puede y deja pendiente lo demas', async () => {
    const buzon = app.get(BuzonService);
    const correo = (uid: number, from: string, subject: string): CorreoLeido => ({
      uid, from, subject, messageId: `<${uid}@correo.test>`, fromNombre: uid % 2 ? 'Juzgado 17 Penal' : null,
      date: '2026-11-11T21:54:06Z', adjuntos: uid === 12 ? ['Fallo.pdf'] : [],
    });
    const juzgado = 'j17pccbt@cendoj.ramajudicial.gov.co';
    const tutela = await crearTutela('11001310901720260979500');

    lector.correos = [correo(10, juzgado, 'NOTIFICA AUTO AVOCA TUTELA 110013109017-2026 - 9795')];
    expect(await buzon.sincronizar()).toEqual({ leidos: 0, vinculados: 0, pendientes: 0 });
    expect(await datos.query('SELECT count(*)::int AS n FROM actuaciones')).toEqual([{ n: 0 }]);

    lector.correos = [
      ...lector.correos,
      correo(11, 'boletin@tienda.com', 'Oferta 11001310901720260979500'),
      correo(12, juzgado, 'NOTIFICA FALLO TUTELA 110013109017-2026 - 9795'),
      correo(13, juzgado, 'NOTIFICA AUTO ADMITE TUTELA 2026-00444'),
    ];
    expect(await buzon.sincronizar()).toEqual({ leidos: 3, vinculados: 1, pendientes: 1 });
    expect(await buzon.sincronizar()).toEqual({ leidos: 0, vinculados: 0, pendientes: 0 });
    const actuaciones = await datos.query('SELECT tramite_id, categoria, anotacion FROM actuaciones');
    expect(actuaciones).toEqual([{ tramite_id: tutela.id, categoria: 'FALLO', anotacion: expect.stringContaining('Fallo.pdf') }]);

    const pendientes = (await conLlave(api().get('/v1/correos/pendientes')).expect(200)).body.data;
    expect(pendientes).toMatchObject([{ asunto: 'NOTIFICA AUTO ADMITE TUTELA 2026-00444', motivo: 'SIN_TRAMITE', remitente: juzgado }]);
    await conLlave(api().delete(`/v1/correos/pendientes/${pendientes[0].id}`)).expect(200);
    await conLlave(api().delete(`/v1/correos/pendientes/${pendientes[0].id}`)).expect(404);

    lector.uidValidity = '2';
    lector.correos = [correo(1, juzgado, 'NOTIFICA FALLO TUTELA 110013109017-2026 - 9795')];
    expect(await buzon.sincronizar()).toEqual({ leidos: 0, vinculados: 0, pendientes: 0 });
    expect(await datos.query('SELECT uid_validity, ultimo_uid FROM buzones')).toEqual([{ uid_validity: '2', ultimo_uid: 1 }]);

    lector.buzon = null;
    expect(await buzon.sincronizar()).toEqual({ leidos: 0, vinculados: 0, pendientes: 0 });
  });

  test('guarda la credencial cifrada, nunca la devuelve y revisa el portal del Ministerio', async () => {
    const crear = (cuerpo: Record<string, unknown>) => conLlave(api().post('/v1/tramites')).send({ referenciaCrm: 'E4MXO9T4', ...cuerpo });
    const convalidacion = (await crear({ tipo: 'CONVALIDACION_MEN', radicado: '2026-ER-100200' })).body.data;
    const credencial = { usuario: 'cliente.ejemplo', clave: 'Cl4ve-Secreta!' };
    const ruta = `/v1/tramites/${convalidacion.id}`;
    const monitor = app.get(MonitorService);
    /** Simula que ya paso el tiempo minimo entre dos ingresos al portal. */
    const revisar = async () => {
      await datos.query(`UPDATE tramites SET ultima_revision_at = now() - interval '1 hour' WHERE id = $1`, [convalidacion.id]);
      return monitor.revisar(convalidacion.id);
    };

    await conLlave(api().put(`/v1/tramites/${(await crearTutela()).id}/credencial`)).send(credencial).expect(400);
    await conLlave(api().put(`${ruta}/credencial`)).send({ usuario: 'x' }).expect(400);
    await conLlave(api().put(`${ruta}/credencial`)).send(credencial).expect(200, { success: true, data: { credencialConfigurada: true }, error: null });

    const detalle = await conLlave(api().get(ruta)).expect(200);
    expect(detalle.body.data).toMatchObject({ credencialConfigurada: true, tramite: { fuente: 'MEN_CONVALIDACION' } });
    expect(JSON.stringify(detalle.body)).not.toContain('Secreta');
    const [fila] = await datos.query('SELECT usuario, clave FROM credenciales');
    expect(fila.usuario).toMatch(/^v1:/);
    expect(JSON.stringify(fila)).not.toMatch(/cliente\.ejemplo|Secreta/);

    // Se revisan los dos tramites pendientes: la tutela de arriba y la convalidacion.
    expect(await monitor.revisarPendientes()).toBe(2);
    expect(portal.recibidas).toEqual([{ ...credencial, radicado: '2026-ER-100200' }]);
    expect((await conLlave(api().get(ruta))).body.data.tramite).toMatchObject({ estadoFuente: 'Radicado', ultimoError: null });
    expect(await monitor.revisar(convalidacion.id)).toMatchObject({ encontrado: false, error: expect.stringContaining('hace menos de 10 minutos') });
    expect(portal.recibidas).toHaveLength(1);
    expect(await revisar()).toMatchObject({ encontrado: true, actuacionesNuevas: 0 });

    portal.estado = { estado: 'Requerimiento de documentos', detalle: 'Falta el acta de grado apostillada' };
    expect(await revisar()).toMatchObject({ actuacionesNuevas: 1, primeraSincronizacion: false });
    const eventos = await datos.query(`SELECT tipo, payload->'datos' AS datos FROM eventos ORDER BY created_at`);
    expect(eventos.map((evento: { tipo: string }) => evento.tipo)).toEqual(['TRAMITE_SINCRONIZADO', 'ACTUACION_NUEVA']);
    expect(eventos[1].datos).toMatchObject({
      origen: 'PORTAL',
      actuacion: { titulo: 'Cambio de estado: Requerimiento de documentos', categoria: 'REQUERIMIENTO', anotacion: 'Antes: Radicado. Falta el acta de grado apostillada' },
    });

    portal.fallo = new PortalError('texto del portal con Cl4ve-Secreta!', 'NO_DISPONIBLE');
    expect(await revisar()).toMatchObject({ error: 'El portal no respondio' });
    const inesperado = jest.spyOn(portal, 'consultarEstado').mockRejectedValueOnce(new Error('timeout con Cl4ve-Secreta!'));
    expect(await revisar()).toMatchObject({ error: 'El portal no respondio' });
    inesperado.mockRestore();

    // Clave rechazada: se avisa, y no se vuelve a entrar al portal hasta que registren otra.
    portal.fallo = new PortalError('rechazada', 'CREDENCIAL_INVALIDA');
    const intentos = portal.recibidas.length;
    expect(await revisar()).toMatchObject({ encontrado: false, error: expect.stringContaining('rechazo el usuario o la clave') });
    expect(portal.recibidas).toHaveLength(intentos + 1);
    expect(await revisar()).toMatchObject({ error: expect.stringContaining('rechazo') });
    await datos.query(`UPDATE tramites SET proxima_revision_at = now() - interval '1 day' WHERE id = $1`, [convalidacion.id]);
    await monitor.revisarPendientes();
    expect(portal.recibidas).toHaveLength(intentos + 1);
    expect(await datos.query(`SELECT payload->'datos'->>'codigo' AS codigo FROM eventos WHERE tipo = 'ERROR_FUENTE'`)).toEqual([{ codigo: 'CREDENCIAL_INVALIDA' }]);
    expect(JSON.stringify(await datos.query('SELECT ultimo_error FROM tramites UNION ALL SELECT payload::text FROM eventos'))).not.toContain('Secreta');

    const accesos = (await conLlave(api().get(`${ruta}/accesos`)).expect(200)).body.data;
    expect(accesos.map((acceso: { resultado: string }) => acceso.resultado)).toEqual(['CREDENCIAL_INVALIDA', 'NO_DISPONIBLE', 'NO_DISPONIBLE', 'OK', 'OK', 'OK']);

    // Con una credencial nueva se levanta el freno.
    portal.fallo = null;
    await conLlave(api().put(`${ruta}/credencial`)).send({ usuario: 'cliente.ejemplo', clave: 'Nueva-2026' }).expect(200);
    expect(await revisar()).toMatchObject({ encontrado: true, error: null });
    expect(portal.recibidas.at(-1)).toMatchObject({ clave: 'Nueva-2026' });

    // Llave anterior: lo guardado se sigue leyendo y se vuelve a cifrar con la llave actual.
    const env = app.get<Env>(ENV);
    const repositorios = [datos.getRepository('Credencial'), datos.getRepository('AccesoPortal')] as const;
    const boveda = (cambios: Partial<Env>) => new BovedaService(repositorios[0] as never, repositorios[1] as never, { ...env, ...cambios });
    const llaveNueva = Buffer.alloc(32, 9).toString('base64');
    const rotada = boveda({ CREDENCIALES_LLAVE: llaveNueva, CREDENCIALES_LLAVES_ANTERIORES: [env.CREDENCIALES_LLAVE as string] });
    expect(await rotada.leer(convalidacion.id)).toMatchObject({ clave: 'Nueva-2026' });
    expect(await boveda({ CREDENCIALES_LLAVE: llaveNueva }).leer(convalidacion.id)).toMatchObject({ clave: 'Nueva-2026' });
    expect(await revisar()).toMatchObject({ error: 'No se pudo leer la credencial guardada; registrala de nuevo' });
    await expect(boveda({ CREDENCIALES_LLAVE: undefined }).guardar(convalidacion.id, credencial)).rejects.toThrow(/no esta configurada/);
    expect(() => boveda({ CREDENCIALES_LLAVE: Buffer.alloc(40, 1).toString('base64') })).toThrow(/32 bytes/);

    // Sin credencial, pausado o cerrado no se entra al portal; al cerrar se borra la clave.
    await conLlave(api().delete(`${ruta}/credencial`)).expect(200, { success: true, data: { eliminada: true }, error: null });
    await conLlave(api().delete(`${ruta}/credencial`)).expect(200, { success: true, data: { eliminada: false }, error: null });
    expect(await revisar()).toMatchObject({ error: expect.stringContaining('Falta registrar') });
    await conLlave(api().put(`${ruta}/credencial`)).send(credencial).expect(200);
    await conLlave(api().patch(ruta)).send({ estado: 'CERRADO' }).expect(200);
    expect((await conLlave(api().get(ruta))).body.data.credencialConfigurada).toBe(false);
    expect(await revisar()).toMatchObject({ error: 'El tramite no esta activo' });
  });

  test('la convalidacion y la legalizacion del Ministerio usan portales distintos', async () => {
    const crear = (cuerpo: Record<string, unknown>) => conLlave(api().post('/v1/tramites')).send(cuerpo);
    const legalizacion = (await crear({ tipo: 'LEGALIZACION_MEN', radicado: 'LEG-2026-555' }).expect(201)).body.data;
    expect(legalizacion.fuente).toBe('MANUAL');
    await conLlave(api().put(`/v1/tramites/${legalizacion.id}/credencial`)).send({ usuario: 'u', clave: 'c' }).expect(200);
    expect((await conLlave(api().get(`/v1/tramites/${legalizacion.id}`))).body.data.tramite.fuente).toBe('MEN_LEGALIZACION');
    // Aun no hay lector para legalizaciones: no se revisa sola y la revision manual lo dice.
    expect(await app.get(MonitorService).revisarPendientes()).toBe(0);
    await conLlave(api().post(`/v1/tramites/${legalizacion.id}/revisar`)).expect(501);

    expect((await crear({ tipo: 'CONVALIDACION_MEN', radicado: 'C-1', fuente: 'MEN_CONVALIDACION' }).expect(201)).body.data.fuente).toBe('MEN_CONVALIDACION');
    await crear({ tipo: 'CONVALIDACION_MEN', radicado: 'C-2', fuente: 'MEN_LEGALIZACION' }).expect(400);
    await crear({ tipo: 'TUTELA', radicado: '11001310300120260012399', fuente: 'MEN_CONVALIDACION' }).expect(400);
    const sac = (await crear({ tipo: 'SAC_MEN', radicado: 'SAC-9' }).expect(201)).body.data;
    await conLlave(api().put(`/v1/tramites/${sac.id}/credencial`)).send({ usuario: 'u', clave: 'c' }).expect(400);

    const vacio = await conLlave(api().put(`/v1/tramites/${legalizacion.id}/credencial`)).set('content-type', 'application/json').send('{"usuario":"u","clave":"Secr3ta-del-cliente"').expect(400);
    expect(JSON.stringify(vacio.body)).not.toContain('Secr3ta');
  });

  test('un cuerpo mal formado responde 400 y no 500', async () => {
    const respuesta = await conLlave(api().post('/v1/tramites')).set('content-type', 'application/json').send('{"tipo":').expect(400);
    expect(respuesta.body).toMatchObject({ success: false, data: null, error: { code: 'BAD_REQUEST' } });
    await conLlave(api().get('/v1/eventos?cursor=2026-99-99T00:00:00.000Z_816d1e22-b94d-46b2-8ce4-a0a5dd000f8f')).expect(400);
  });

  test('el planificador respeta el apagado, no se pisa y no se cae con errores', async () => {
    const env = app.get<Env>(ENV);
    const monitor = app.get(MonitorService);
    const eventos = app.get(EventosService);
    let ejecuciones = 0;
    const apagado = new Planificador(env, monitor, eventos, app.get(BuzonService));
    await apagado.ejecutar('x', async () => void (ejecuciones += 1));
    expect(ejecuciones).toBe(0);

    const encendido = new Planificador({ ...env, SCHEDULER_ENABLED: true }, monitor, eventos, app.get(BuzonService));
    let liberar: () => void = () => undefined;
    const lenta = encendido.ejecutar('x', () => new Promise<void>((resolver) => (liberar = resolver)));
    await encendido.ejecutar('x', async () => void (ejecuciones += 1));
    expect(ejecuciones).toBe(0);
    liberar();
    await lenta;
    await encendido.ejecutar('x', async () => {
      throw new Error('fallo');
    });
    await encendido.ejecutar('x', async () => void (ejecuciones += 1));
    expect(ejecuciones).toBe(1);
    await expect(Promise.all([encendido.revisarTramites(), encendido.entregarAvisos(), encendido.avisarTerminos(), encendido.leerBuzon()])).resolves.toBeDefined();
  });

  test('limita las revisiones manuales por minuto', async () => {
    const tutela = await crearTutela();
    const estados: number[] = [];
    for (let intento = 0; intento < 12; intento += 1) {
      estados.push((await conLlave(api().post(`/v1/tramites/${tutela.id}/revisar`))).status);
    }
    expect(estados).toContain(429);
    await api().get('/health').expect(200);
  });
});
