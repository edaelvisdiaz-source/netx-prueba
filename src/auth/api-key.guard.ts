import {
  CanActivate, ExecutionContext, Inject, Injectable, Logger, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ENV, Env } from '../config/env';

const ES_PUBLICO = 'esPublico';
export const Publico = () => SetMetadata(ES_PUBLICO, true);

function huella(valor: string): Buffer {
  return createHash('sha256').update(valor).digest();
}

/** Exige el encabezado X-Api-Key. Compara huellas en tiempo constante. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly huellas: ReadonlyArray<Buffer>;

  constructor(@Inject(ENV) env: Env, private readonly reflector: Reflector) {
    this.huellas = env.RADIKA_API_KEYS.map(huella);
  }

  canActivate(contexto: ExecutionContext): boolean {
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico) return true;
    const peticion = contexto.switchToHttp().getRequest<Request>();
    const encabezado = peticion.headers['x-api-key'];
    const recibida = huella(typeof encabezado === 'string' ? encabezado : '');
    const coincide = this.huellas.reduce(
      (encontrada, esperada) => timingSafeEqual(recibida, esperada) || encontrada,
      false,
    );
    if (!coincide) {
      this.logger.warn(`Llave de API rechazada en ${peticion.method} ${peticion.path} desde ${peticion.ip}`);
      throw new UnauthorizedException('Llave de API ausente o invalida');
    }
    return true;
  }
}
