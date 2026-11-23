import { BadRequestException, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ok } from '../common/respuesta';
import { TramitesService } from '../tramites/tramites.service';
import { DocumentosService } from './documentos.service';

const SUBIDAS_POR_MINUTO = 30;
const VENTANA_MS = 60_000;

function nombreDelEncabezado(valor: string | undefined): string {
  if (!valor) return 'documento';
  try {
    return decodeURIComponent(valor);
  } catch {
    throw new BadRequestException('El nombre del archivo no es valido');
  }
}

@Controller()
export class DocumentosController {
  constructor(
    private readonly documentos: DocumentosService,
    private readonly tramites: TramitesService,
  ) {}

  @Get('v1/tramites/:id/documentos')
  async listar(@Param('id', ParseUUIDPipe) id: string) {
    await this.tramites.obtener(id);
    return ok({ activo: this.documentos.activo, documentos: await this.documentos.listar(id) });
  }

  /** El archivo viaja tal cual en el cuerpo; su nombre, codificado para URL, en `X-Nombre-Archivo`. */
  @Post('v1/tramites/:id/documentos')
  @Throttle({ default: { limit: SUBIDAS_POR_MINUTO, ttl: VENTANA_MS } })
  async subir(@Param('id', ParseUUIDPipe) id: string, @Req() peticion: Request, @Headers('x-nombre-archivo') nombre?: string) {
    await this.tramites.obtener(id);
    if (!Buffer.isBuffer(peticion.body)) throw new BadRequestException('Envia el archivo como PDF, PNG o JPG en el cuerpo de la peticion');
    return ok(await this.documentos.agregar(id, { nombre: nombreDelEncabezado(nombre), contenido: peticion.body, origen: 'MANUAL' }));
  }

  /** Entrega el archivo para verlo en el visor. Solo se puede incrustar dentro de Radika. */
  @Get('v1/documentos/:id/contenido')
  async contenido(@Param('id', ParseUUIDPipe) id: string, @Res() respuesta: Response): Promise<void> {
    const { documento, contenido } = await this.documentos.abrir(id);
    respuesta.setHeader('Content-Type', documento.tipo);
    respuesta.setHeader('Content-Length', String(contenido.length));
    respuesta.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(documento.nombre)}`);
    respuesta.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    respuesta.setHeader('X-Content-Type-Options', 'nosniff');
    respuesta.setHeader('Cache-Control', 'private, no-store');
    respuesta.end(contenido);
  }

  @Delete('v1/documentos/:id')
  @HttpCode(HttpStatus.OK)
  async eliminar(@Param('id', ParseUUIDPipe) id: string) {
    await this.documentos.eliminar(id);
    return ok({ eliminado: true });
  }
}
