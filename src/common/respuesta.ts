import {
  ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

export interface Meta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface Respuesta<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } | null;
  readonly meta?: Meta;
}

export function ok<T>(data: T, meta?: Meta): Respuesta<T> {
  return meta ? { success: true, data, error: null, meta } : { success: true, data, error: null };
}

/** Valida datos de entrada con un esquema; responde 400 con el detalle por campo. */
export function validar<T>(esquema: z.ZodType<T, z.ZodTypeDef, unknown>, valor: unknown): T {
  const resultado = esquema.safeParse(valor);
  if (!resultado.success) {
    throw new BadRequestException({
      message: 'Datos invalidos',
      details: resultado.error.issues.map((problema) => ({
        campo: problema.path.join('.'),
        mensaje: problema.message,
      })),
    });
  }
  return resultado.data;
}

/** Todas las respuestas de error salen con el mismo sobre y sin detalles internos. */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  catch(excepcion: unknown, host: ArgumentsHost): void {
    const respuesta = host.switchToHttp().getResponse<Response>();
    if (excepcion instanceof HttpException) {
      const estado = excepcion.getStatus();
      const cuerpo = excepcion.getResponse();
      const detalle = typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as Record<string, unknown>) : {};
      const original = typeof detalle.message === 'string' ? detalle.message : excepcion.message;
      // El lector de JSON puede citar un pedazo del cuerpo recibido; no se repite.
      const mensaje = estado === HttpStatus.BAD_REQUEST && detalle.details === undefined && /JSON/i.test(original) ? 'JSON invalido' : original;
      respuesta.status(estado).json({
        success: false,
        data: null,
        error: { code: HttpStatus[estado] ?? 'ERROR', message: mensaje, details: detalle.details },
      } satisfies Respuesta<never>);
      return;
    }
    this.logger.error(excepcion instanceof Error ? excepcion.stack : String(excepcion));
    respuesta.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error interno' },
    } satisfies Respuesta<never>);
  }
}
