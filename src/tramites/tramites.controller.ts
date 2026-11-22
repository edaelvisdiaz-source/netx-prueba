import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Publico } from '../auth/api-key.guard';
import { ok, validar } from '../common/respuesta';
import { BuzonService } from '../correo/buzon.service';
import { MonitorService } from '../monitor/monitor.service';
import { EventosService } from '../notificaciones/eventos.service';
import {
  actualizarTramiteSchema, crearTramiteSchema, listarEventosSchema, listarTramitesSchema,
  correoEntranteSchema, registrarActuacionSchema,
} from './dto';
import { TramitesService } from './tramites.service';

const REVISIONES_MANUALES_POR_MINUTO = 10;
const VENTANA_MS = 60_000;

@Controller()
export class TramitesController {
  constructor(
    private readonly tramites: TramitesService,
    private readonly monitor: MonitorService,
    private readonly eventos: EventosService,
    private readonly buzon: BuzonService,
  ) {}

  @Publico()
  @SkipThrottle()
  @Get('health')
  salud() {
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
    return ok(await this.tramites.detalle(id));
  }

  @Patch('v1/tramites/:id')
  async actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() cuerpo: unknown) {
    return ok(await this.tramites.actualizar(id, validar(actualizarTramiteSchema, cuerpo)));
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

  /** Vuelve a poner en cola los avisos que agotaron sus intentos (por ejemplo tras una caida larga del CRM). */
  @Post('v1/eventos/reintentar')
  @HttpCode(HttpStatus.OK)
  async reintentarEventos() {
    return ok({ reencolados: await this.eventos.reencolarFallidos() });
  }
}
