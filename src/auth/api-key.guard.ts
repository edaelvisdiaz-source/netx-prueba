import {
  CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Logger, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ENV, Env } from '../config/env';
import { Usuario } from '../usuarios/usuario.entity';
import { UsuariosService } from '../usuarios/usuarios.service';

const ES_PUBLICO = 'esPublico';
const SOLO_ADMIN = 'soloAdmin';
const CON_CLAVE_TEMPORAL = 'conClaveTemporal';
/** Ruta sin autenticacion. */
export const Publico = () => SetMetadata(ES_PUBLICO, true);
/** Ruta reservada a administradores (o a la llave de API). */
export const SoloAdmin = () => SetMetadata(SOLO_ADMIN, true);
/** Ruta que se puede usar antes de cambiar la clave temporal. */
export const ConClaveTemporal = () => SetMetadata(CON_CLAVE_TEMPORAL, true);

export const COOKIE_SESION = 'radika_sesion';
export const ENCABEZADO_APP = 'x-radika';
const METODOS_DE_LECTURA: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Peticion ya autenticada: `usuario` es `null` cuando entro con la llave de API. */
export type PeticionAutenticada = Request & { usuario?: Usuario | null; tokenSesion?: string };

function huella(valor: string): Buffer {
  return createHash('sha256').update(valor).digest();
}

export function leerCookie(peticion: Request, nombre: string): string | null {
  const encabezado = peticion.headers.cookie;
  if (!encabezado) return null;
  for (const parte of encabezado.split(';')) {
    const [clave, ...valor] = parte.trim().split('=');
    if (clave === nombre) return decodeURIComponent(valor.join('='));
  }
  return null;
}

/**
 * Deja pasar con la llave de API (otros sistemas) o con una sesion de usuario (las pantallas).
 * Las sesiones viajan en una cookie; para que otra pagina no pueda usarla a espaldas del usuario,
 * todo cambio hecho con sesion debe traer ademas el encabezado propio de la aplicacion.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly huellas: ReadonlyArray<Buffer>;

  constructor(
    @Inject(ENV) env: Env,
    private readonly reflector: Reflector,
    private readonly usuarios: UsuariosService,
  ) {
    this.huellas = env.RADIKA_API_KEYS.map(huella);
  }

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const marca = <T>(clave: string) => this.reflector.getAllAndOverride<T>(clave, [contexto.getHandler(), contexto.getClass()]);
    if (marca<boolean>(ES_PUBLICO)) return true;
    const peticion = contexto.switchToHttp().getRequest<PeticionAutenticada>();

    const llave = peticion.headers['x-api-key'];
    if (typeof llave === 'string') {
      const recibida = huella(llave);
      if (this.huellas.reduce((encontrada, esperada) => timingSafeEqual(recibida, esperada) || encontrada, false)) {
        // La llave es para integraciones (el CRM). Administrar personas exige la sesion de un administrador.
        if (marca<boolean>(SOLO_ADMIN)) throw new ForbiddenException('Esto solo lo puede hacer un administrador con su sesion');
        peticion.usuario = null;
        return true;
      }
    }

    const token = leerCookie(peticion, COOKIE_SESION);
    const usuario = token ? await this.usuarios.usuarioDeSesion(token) : null;
    if (!token || !usuario) {
      this.logger.warn(`Acceso rechazado en ${peticion.method} ${peticion.path} desde ${peticion.ip}`);
      throw new UnauthorizedException('Inicia sesion para continuar');
    }
    if (!METODOS_DE_LECTURA.has(peticion.method) && peticion.headers[ENCABEZADO_APP] !== '1') {
      throw new ForbiddenException('Peticion no permitida desde fuera de la aplicacion');
    }
    if (usuario.debeCambiarClave && !marca<boolean>(CON_CLAVE_TEMPORAL)) {
      throw new ForbiddenException('Debes cambiar tu clave temporal antes de continuar');
    }
    if (marca<boolean>(SOLO_ADMIN) && usuario.rol !== 'ADMIN') {
      throw new ForbiddenException('Solo un administrador puede hacer esto');
    }
    peticion.usuario = usuario;
    peticion.tokenSesion = token;
    return true;
  }
}
