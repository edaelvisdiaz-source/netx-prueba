import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
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
    const encabezado = contexto.switchToHttp().getRequest<Request>().headers['x-api-key'];
    const recibida = huella(typeof encabezado === 'string' ? encabezado : '');
    const coincide = this.huellas.reduce(
      (encontrada, esperada) => timingSafeEqual(recibida, esperada) || encontrada,
      false,
    );
    if (!coincide) throw new UnauthorizedException('Llave de API ausente o invalida');
    return true;
  }
}
