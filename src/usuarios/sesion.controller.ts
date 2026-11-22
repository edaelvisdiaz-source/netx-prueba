import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Inject, Param,
  ParseUUIDPipe, Patch, Post, Put, Req, Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ConClaveTemporal, COOKIE_SESION, ENCABEZADO_APP, PeticionAutenticada, Publico, SoloAdmin,
} from '../auth/api-key.guard';
import { ok, validar } from '../common/respuesta';
import { ENV, Env } from '../config/env';
import { LARGO_MINIMO_CLAVE } from './claves';
import { ROLES } from './usuario.entity';
import { UsuariosService } from './usuarios.service';

const INGRESOS_POR_MINUTO = 10;
const VENTANA_MS = 60_000;

const ingresoSchema = z.object({ email: z.string().trim().email().max(320), clave: z.string().min(1).max(200) }).strict();
const cambioClaveSchema = z
  .object({ actual: z.string().min(1).max(200), nueva: z.string().min(LARGO_MINIMO_CLAVE, `minimo ${LARGO_MINIMO_CLAVE} caracteres`).max(200) })
  .strict()
  .refine((datos) => datos.actual !== datos.nueva, { message: 'la clave nueva debe ser distinta', path: ['nueva'] });
const crearUsuarioSchema = z
  .object({ email: z.string().trim().email().max(320), nombre: z.string().trim().min(2).max(120), rol: z.enum(ROLES).default('ASESOR') })
  .strict();
const administrarSchema = z
  .object({ activo: z.boolean().optional(), rol: z.enum(ROLES).optional(), nuevaClave: z.literal(true).optional() })
  .strict()
  .refine((cambios) => Object.keys(cambios).length > 0, { message: 'envia al menos un campo' });

@Controller('v1')
export class SesionController {
  constructor(
    private readonly usuarios: UsuariosService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Publico()
  @Post('sesion')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: INGRESOS_POR_MINUTO, ttl: VENTANA_MS } })
  async ingresar(@Req() peticion: PeticionAutenticada, @Body() cuerpo: unknown, @Res({ passthrough: true }) respuesta: Response) {
    if (peticion.headers[ENCABEZADO_APP] !== '1') throw new ForbiddenException('Peticion no permitida desde fuera de la aplicacion');
    const { email, clave } = validar(ingresoSchema, cuerpo);
    const sesion = await this.usuarios.ingresar(email, clave);
    respuesta.cookie(COOKIE_SESION, sesion.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.env.NODE_ENV === 'production',
      expires: sesion.expira,
      path: '/',
    });
    return ok({ usuario: sesion.usuario });
  }

  @ConClaveTemporal()
  @Get('sesion')
  actual(@Req() peticion: PeticionAutenticada) {
    return ok({ usuario: peticion.usuario ?? null });
  }

  @ConClaveTemporal()
  @Delete('sesion')
  @HttpCode(HttpStatus.OK)
  async salir(@Req() peticion: PeticionAutenticada, @Res({ passthrough: true }) respuesta: Response) {
    if (peticion.tokenSesion) await this.usuarios.salir(peticion.tokenSesion);
    respuesta.clearCookie(COOKIE_SESION, { path: '/' });
    return ok({ cerrada: true });
  }

  @ConClaveTemporal()
  @Put('sesion/clave')
  async cambiarClave(@Req() peticion: PeticionAutenticada, @Body() cuerpo: unknown) {
    if (!peticion.usuario || !peticion.tokenSesion) throw new BadRequestException('Solo aplica a usuarios con sesion');
    const { actual, nueva } = validar(cambioClaveSchema, cuerpo);
    await this.usuarios.cambiarClave(peticion.usuario.id, actual, nueva, peticion.tokenSesion);
    return ok({ cambiada: true });
  }

  @SoloAdmin()
  @Get('usuarios')
  async listar() {
    return ok(await this.usuarios.listar());
  }

  /** Devuelve la clave temporal una sola vez, para entregarsela a la persona. */
  @SoloAdmin()
  @Post('usuarios')
  async crear(@Body() cuerpo: unknown) {
    return ok(await this.usuarios.crear(validar(crearUsuarioSchema, cuerpo)));
  }

  @SoloAdmin()
  @Patch('usuarios/:id')
  async administrar(@Req() peticion: PeticionAutenticada, @Param('id', ParseUUIDPipe) id: string, @Body() cuerpo: unknown) {
    const cambios = validar(administrarSchema, cuerpo);
    if (peticion.usuario?.id === id && (cambios.activo === false || cambios.rol === 'ASESOR')) {
      throw new BadRequestException('No puedes quitarte a ti mismo el acceso de administrador');
    }
    return ok(await this.usuarios.administrar(id, cambios));
  }
}
