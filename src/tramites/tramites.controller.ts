import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Publico } from '../auth/api-key.guard';
import { ok, validar } from '../common/respuesta';
import { BovedaService } from '../boveda/boveda.service';
import { BuzonService } from '../correo/buzon.service';
import { MonitorService } from '../monitor/monitor.service';
import { EventosService } from '../notificaciones/eventos.service';
import {
  actualizarTramiteSchema, crearTramiteSchema, listarEventosSchema, listarTramitesSchema,
  correoEntranteSchema, credencialSchema, registrarActuacionSchema,
} from './dto';
import { TramitesService } from './tramites.service';

const REVISIONES_MANUALES_POR_MINUTO = 10;
const NOVEDADES_EN_PANTALLA = 100;
const CAMBIOS_DE_CREDENCIAL_POR_MINUTO = 30;
const VENTANA_MS = 60_000;

@Controller()
export class TramitesController {
  constructor(
    private readonly tramites: TramitesService,
    private readonly monitor: MonitorService,
    private readonly eventos: EventosService,
    private readonly buzon: BuzonService,
    @InjectDataSource() private readonly datos: DataSource,
    private readonly boveda: BovedaService,
  ) {}

  @Publico()
  @SkipThrottle()
  @Get('health')
  async salud() {
    try {
      await this.datos.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('La base de datos no responde');
    }
    return ok({ estado: 'ok' });
  }

  @Post('v1/tramites')
  async crear(@Body() cuerpo: unknown) {
    return ok(await this.tramites.crear(validar(crearTramiteSchema, cuerpo)));
  }

  @Get('v1/tramites')
  async listar(@Query() consulta: unknown) {
    const filtros = validar(listarTramitesSchema, consulta);
    const { items, total } = await this.tramites.listar(filtros);
    return ok(items, { total, page: filtros.page, limit: filtros.limit });
  }

  @Get('v1/tramites/:id')
  async detalle(@Param('id', ParseUUIDPipe) id: string) {
    return ok({ ...(await this.tramites.detalle(id)), credencialConfigurada: await this.boveda.existe(id) });
  }

  @Patch('v1/tramites/:id')
  async actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() cuerpo: unknown) {
    const cambios = validar(actualizarTramiteSchema, cuerpo);
    const actualizado = await this.tramites.actualizar(id, cambios);
    // Un tramite cerrado ya no necesita la clave del cliente: se borra.
    if (cambios.estado === 'CERRADO') await this.boveda.eliminar(id);
    return ok(actualizado);
  }

  @Delete('v1/tramites/:id')
  @HttpCode(HttpStatus.OK)
  async eliminar(@Param('id', ParseUUIDPipe) id: string) {
    await this.tramites.eliminar(id);
    return ok({ eliminado: true });
  }

  @Post('v1/tramites/:id/revisar')
  @Throttle({ default: { limit: REVISIONES_MANUALES_POR_MINUTO, ttl: VENTANA_MS } })
  @HttpCode(HttpStatus.OK)
  async revisar(@Param('id', ParseUUIDPipe) id: string) {
    return ok(await this.monitor.revisar(id));
  }

  /** Guarda (o reemplaza) el usuario y la clave del portal. Nunca se devuelven. */
  @Put('v1/tramites/:id/credencial')
  @Throttle({ default: { limit: CAMBIOS_DE_CREDENCIAL_POR_MINUTO, ttl: VENTANA_MS } })
  async guardarCredencial(@Param('id', ParseUUIDPipe) id: string, @Body() cuerpo: unknown) {
    const credencial = validar(credencialSchema, cuerpo);
    await this.tramites.exigirTipoConPortal(id);
    this.boveda.exigirConfigurada();
    await this.boveda.guardar(id, credencial);
    await this.tramites.activarPortal(id);
    return ok({ credencialConfigurada: true });
  }

  @Delete('v1/tramites/:id/credencial')
  @HttpCode(HttpStatus.OK)
  async eliminarCredencial(@Param('id', ParseUUIDPipe) id: string) {
    await this.tramites.obtener(id);
    return ok({ eliminada: await this.boveda.eliminar(id) });
  }

  /** Bitacora de las veces que Radika entro al portal con la credencial de este tramite. */
  @Get('v1/tramites/:id/accesos')
  async accesos(@Param('id', ParseUUIDPipe) id: string) {
    await this.tramites.obtener(id);
    return ok(await this.boveda.listarAccesos(id));
  }

  @Post('v1/tramites/:id/actuaciones')
  async registrarActuacion(@Param('id', ParseUUIDPipe) id: string, @Body() cuerpo: unknown) {
    return ok(await this.monitor.registrarManual(id, validar(registrarActuacionSchema, cuerpo)));
  }

  /** Recibe un correo de un despacho (lo envia el lector del buzon) y lo enlaza con su tramite. */
  @Post('v1/correos')
  @HttpCode(HttpStatus.OK)
  async recibirCorreo(@Body() cuerpo: unknown) {
    return ok(await this.monitor.registrarCorreo(validar(correoEntranteSchema, cuerpo)));
  }

  /** Correos de despachos que no se pudieron enlazar con un tramite. */
  @Get('v1/correos/pendientes')
  async correosPendientes() {
    return ok(await this.buzon.listarPendientes());
  }

  @Delete('v1/correos/pendientes/:id')
  @HttpCode(HttpStatus.OK)
  async descartarCorreo(@Param('id', ParseUUIDPipe) id: string) {
    await this.buzon.descartarPendiente(id);
    return ok({ descartado: true });
  }

  @Get('v1/eventos')
  async listarEventos(@Query() consulta: unknown) {
    const { cursor, limit } = validar(listarEventosSchema, consulta);
    const { items, siguiente } = await this.eventos.listar(cursor, limit);
    return ok({ eventos: items, siguiente });
  }

  @Get('v1/novedades')
  async novedades() {
    return ok(await this.eventos.recientes(NOVEDADES_EN_PANTALLA));
  }

  /** Vuelve a poner en cola los avisos que agotaron sus intentos (por ejemplo tras una caida larga del CRM). */
  @Post('v1/eventos/reintentar')
  @HttpCode(HttpStatus.OK)
  async reintentarEventos() {
    return ok({ reencolados: await this.eventos.reencolarFallidos() });
  }
}
