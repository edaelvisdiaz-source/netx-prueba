import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Publico } from '../auth/api-key.guard';
import { ok, validar } from '../common/respuesta';
import { MonitorService } from '../monitor/monitor.service';
import { EventosService } from '../notificaciones/eventos.service';
import {
  actualizarTramiteSchema, crearTramiteSchema, listarEventosSchema, listarTramitesSchema,
} from './dto';
import { TramitesService } from './tramites.service';

@Controller()
export class TramitesController {
  constructor(
    private readonly tramites: TramitesService,
    private readonly monitor: MonitorService,
    private readonly eventos: EventosService,
  ) {}

  @Publico()
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
  @HttpCode(HttpStatus.OK)
  async revisar(@Param('id', ParseUUIDPipe) id: string) {
    return ok(await this.monitor.revisar(id));
  }

  @Get('v1/eventos')
  async listarEventos(@Query() consulta: unknown) {
    const { cursor, limit } = validar(listarEventosSchema, consulta);
    const { items, siguiente } = await this.eventos.listar(cursor, limit);
    return ok({ eventos: items, siguiente });
  }
}
