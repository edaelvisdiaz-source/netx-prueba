import { BadRequestException, Controller, PayloadTooLargeException, Query, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ok } from '../common/respuesta';
import { TramitesService } from '../tramites/tramites.service';
import { BYTES_MAXIMOS_DOCUMENTO, DocumentosService } from './documentos.service';

const SUBIDAS_POR_MINUTO = 30;
const VENTANA_MS = 60_000;

const TIPOS_DE_SUBIDA: ReadonlySet<string> = new Set(['application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream']);

/**
 * Lee el archivo del cuerpo de la peticion con un tope de tamano. Se hace aqui, y no con un
 * middleware, para que ocurra despues de comprobar la llave o la sesion: nadie sin acceso
 * puede hacer que el servidor reciba megas.
 */
function leerArchivo(peticion: Request): Promise<Buffer> {
  const tipo = (peticion.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!TIPOS_DE_SUBIDA.has(tipo)) throw new BadRequestException('Envia el archivo como PDF, PNG o JPG en el cuerpo de la peticion');
  if (Number(peticion.headers['content-length'] ?? 0) > BYTES_MAXIMOS_DOCUMENTO) throw new PayloadTooLargeException('El archivo supera los 15 MB');
  return new Promise((resolver, rechazar) => {
    const trozos: Buffer[] = [];
    let total = 0;
    peticion.on('data', (trozo: Buffer) => {
      total += trozo.length;
      if (total > BYTES_MAXIMOS_DOCUMENTO) {
        peticion.destroy();
        rechazar(new PayloadTooLargeException('El archivo supera los 15 MB'));
        return;
      }
      trozos.push(trozo);
    });
    peticion.on('end', () => resolver(Buffer.concat(trozos)));
    peticion.on('error', () => rechazar(new BadRequestException('No se pudo recibir el archivo')));
  });
}

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
  async subir(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() peticion: Request,
    @Headers('x-nombre-archivo') nombre?: string,
    @Query('actuacionId', new ParseUUIDPipe({ optional: true })) actuacionId?: string,
  ) {
    await this.tramites.obtener(id);
    // Opcional: la actuacion a la que pertenece el documento, para verlo en la linea de tiempo.
    if (actuacionId) await this.tramites.exigirActuacion(id, actuacionId);
    return ok(await this.documentos.agregar(id, { nombre: nombreDelEncabezado(nombre), contenido: await leerArchivo(peticion), origen: 'MANUAL', actuacionId }));
  }

  /** Entrega el archivo para verlo en el visor. Solo se puede incrustar dentro de Radika. */
  @Get('v1/documentos/:id/contenido')
  async contenido(@Param('id', ParseUUIDPipe) id: string, @Res() respuesta: Response, @Query('descargar') descargar?: string): Promise<void> {
    const { documento, contenido } = await this.documentos.abrir(id);
    respuesta.setHeader('Content-Type', documento.tipo);
    respuesta.setHeader('Content-Length', String(contenido.length));
    respuesta.setHeader('Content-Disposition', `${descargar === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(documento.nombre)}`);
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
