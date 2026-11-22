import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ENV, Env } from '../config/env';
import { BYTES_LLAVE, cifrar, descifrar } from './cifrado';
import { AccesoPortal, Credencial } from './credencial.entity';

const ACCESOS_POR_PAGINA = 50;

export interface CredencialPortal {
  readonly usuario: string;
  readonly clave: string;
}

/**
 * Guarda las credenciales de los portales. Se pueden escribir y reemplazar, pero ninguna ruta de
 * la API las devuelve: solo las lee el lector del portal en el momento de consultar.
 */
@Injectable()
export class BovedaService {
  private readonly llave: Buffer | null;

  constructor(
    @InjectRepository(Credencial) private readonly credenciales: Repository<Credencial>,
    @InjectRepository(AccesoPortal) private readonly accesos: Repository<AccesoPortal>,
    @Inject(ENV) env: Env,
  ) {
    this.llave = env.CREDENCIALES_LLAVE ? Buffer.from(env.CREDENCIALES_LLAVE, 'base64') : null;
    if (this.llave && this.llave.length !== BYTES_LLAVE) {
      throw new Error('CREDENCIALES_LLAVE debe ser de 32 bytes en base64');
    }
  }

  async guardar(tramiteId: string, credencial: CredencialPortal): Promise<void> {
    const llave = this.exigirLlave();
    await this.credenciales.save({
      tramiteId,
      usuario: cifrar(llave, credencial.usuario, `${tramiteId}:usuario`),
      clave: cifrar(llave, credencial.clave, `${tramiteId}:clave`),
    });
  }

  async leer(tramiteId: string): Promise<CredencialPortal | null> {
    const guardada = await this.credenciales.findOneBy({ tramiteId });
    if (!guardada) return null;
    const llave = this.exigirLlave();
    return {
      usuario: descifrar(llave, guardada.usuario, `${tramiteId}:usuario`),
      clave: descifrar(llave, guardada.clave, `${tramiteId}:clave`),
    };
  }

  existe(tramiteId: string): Promise<boolean> {
    return this.credenciales.existsBy({ tramiteId });
  }

  async eliminar(tramiteId: string): Promise<boolean> {
    return Boolean((await this.credenciales.delete({ tramiteId })).affected);
  }

  async anotarAcceso(tramiteId: string, fuente: string, resultado: string): Promise<void> {
    await this.accesos.insert({ tramiteId, fuente, resultado });
  }

  listarAccesos(tramiteId: string): Promise<AccesoPortal[]> {
    return this.accesos.find({ where: { tramiteId }, order: { createdAt: 'DESC' }, take: ACCESOS_POR_PAGINA });
  }

  private exigirLlave(): Buffer {
    if (!this.llave) throw new ServiceUnavailableException('La boveda de credenciales no esta configurada');
    return this.llave;
  }
}
