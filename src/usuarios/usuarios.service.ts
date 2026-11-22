import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { LessThan, QueryFailedError, Repository } from 'typeorm';
import { claveCoincide, claveTemporal, huellaDeClave } from './claves';
import { Rol, Sesion, Usuario } from './usuario.entity';

const HORAS_DE_SESION = 12;
const MS_HORA = 3_600_000;
const MS_MINUTO = 60_000;
const INTENTOS_ANTES_DE_BLOQUEAR = 5;
const MINUTOS_DE_BLOQUEO = 15;
const BYTES_TOKEN = 32;
const PG_VIOLACION_UNICA = '23505';
/** Se usa para gastar el mismo tiempo cuando el correo no existe, y no revelar cuales existen. */
const HUELLA_SENUELO = 's1:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
const ERROR_DE_INGRESO = 'Correo o clave incorrectos';

function huellaDeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SesionAbierta {
  readonly token: string;
  readonly expira: Date;
  readonly usuario: Usuario;
}

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(Sesion) private readonly sesiones: Repository<Sesion>,
  ) {}

  /** Crea el usuario con una clave temporal, que se devuelve una sola vez para entregarla. */
  async crear(datos: { email: string; nombre: string; rol: Rol }): Promise<{ usuario: Usuario; claveTemporal: string }> {
    const temporal = claveTemporal();
    try {
      const guardado = await this.usuarios.save(
        this.usuarios.create({
          email: datos.email.trim().toLowerCase(),
          nombre: datos.nombre.trim(),
          rol: datos.rol,
          huellaClave: await huellaDeClave(temporal),
          debeCambiarClave: true,
        }),
      );
      return { usuario: await this.obtener(guardado.id), claveTemporal: temporal };
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_VIOLACION_UNICA) {
        throw new ConflictException('Ya existe un usuario con ese correo');
      }
      throw error;
    }
  }

  listar(): Promise<Usuario[]> {
    return this.usuarios.find({ order: { nombre: 'ASC' } });
  }

  async obtener(id: string): Promise<Usuario> {
    const usuario = await this.usuarios.findOneBy({ id });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    return usuario;
  }

  async ingresar(email: string, clave: string): Promise<SesionAbierta> {
    const usuario = await this.usuarios
      .createQueryBuilder('u')
      .addSelect(['u.huellaClave', 'u.intentosFallidos', 'u.bloqueadoHasta'])
      .where('u.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
    const coincide = await claveCoincide(clave, usuario?.huellaClave ?? HUELLA_SENUELO);
    if (!usuario || !usuario.activo) throw new UnauthorizedException(ERROR_DE_INGRESO);
    if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > new Date()) {
      throw new UnauthorizedException('Demasiados intentos; espera unos minutos');
    }
    if (!coincide) {
      const intentos = usuario.intentosFallidos + 1;
      const bloquear = intentos >= INTENTOS_ANTES_DE_BLOQUEAR;
      await this.usuarios.update(
        { id: usuario.id },
        { intentosFallidos: bloquear ? 0 : intentos, bloqueadoHasta: bloquear ? new Date(Date.now() + MINUTOS_DE_BLOQUEO * MS_MINUTO) : null },
      );
      throw new UnauthorizedException(ERROR_DE_INGRESO);
    }
    await this.usuarios.update({ id: usuario.id }, { intentosFallidos: 0, bloqueadoHasta: null });
    const token = randomBytes(BYTES_TOKEN).toString('base64url');
    const expira = new Date(Date.now() + HORAS_DE_SESION * MS_HORA);
    await this.sesiones.insert({ huellaToken: huellaDeToken(token), usuarioId: usuario.id, expiraAt: expira });
    await this.sesiones.delete({ expiraAt: LessThan(new Date()) });
    return { token, expira, usuario: await this.obtener(usuario.id) };
  }

  /** Usuario de una sesion vigente, o `null`. */
  async usuarioDeSesion(token: string): Promise<Usuario | null> {
    const sesion = await this.sesiones.findOneBy({ huellaToken: huellaDeToken(token) });
    if (!sesion || sesion.expiraAt <= new Date()) return null;
    const usuario = await this.usuarios.findOneBy({ id: sesion.usuarioId });
    return usuario?.activo ? usuario : null;
  }

  async salir(token: string): Promise<void> {
    await this.sesiones.delete({ huellaToken: huellaDeToken(token) });
  }

  /** Cambia la clave propia; cierra las demas sesiones del usuario. */
  async cambiarClave(usuarioId: string, actual: string, nueva: string, tokenVigente: string): Promise<void> {
    const usuario = await this.usuarios.createQueryBuilder('u').addSelect('u.huellaClave').where('u.id = :id', { id: usuarioId }).getOne();
    if (!usuario || !(await claveCoincide(actual, usuario.huellaClave))) throw new UnauthorizedException('La clave actual no coincide');
    await this.usuarios.update({ id: usuarioId }, { huellaClave: await huellaDeClave(nueva), debeCambiarClave: false });
    await this.sesiones
      .createQueryBuilder()
      .delete()
      .where('usuario_id = :id AND huella_token <> :vigente', { id: usuarioId, vigente: huellaDeToken(tokenVigente) })
      .execute();
  }

  /** Un administrador desactiva o reactiva a alguien, o le genera otra clave temporal. */
  async administrar(id: string, cambios: { activo?: boolean; rol?: Rol; nuevaClave?: boolean }): Promise<{ usuario: Usuario; claveTemporal: string | null }> {
    await this.obtener(id);
    const temporal = cambios.nuevaClave ? claveTemporal() : null;
    await this.usuarios.update(
      { id },
      {
        ...(cambios.activo === undefined ? {} : { activo: cambios.activo }),
        ...(cambios.rol === undefined ? {} : { rol: cambios.rol }),
        ...(temporal ? { huellaClave: await huellaDeClave(temporal), debeCambiarClave: true, intentosFallidos: 0, bloqueadoHasta: null } : {}),
      },
    );
    if (temporal || cambios.activo === false) await this.sesiones.delete({ usuarioId: id });
    return { usuario: await this.obtener(id), claveTemporal: temporal };
  }
}
