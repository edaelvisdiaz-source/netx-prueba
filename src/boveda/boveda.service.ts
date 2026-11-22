import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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

/** La credencial guardada no se pudo descifrar con ninguna llave conocida. */
export class CredencialIlegibleError extends Error {
  constructor() {
    super('No se pudo leer la credencial guardada');
    this.name = 'CredencialIlegibleError';
  }
}

/**
 * Guarda las credenciales de los portales. Se pueden escribir y reemplazar, pero ninguna ruta de
 * la API las devuelve: solo las lee el lector del portal en el momento de consultar.
 */
@Injectable()
export class BovedaService {
  private readonly logger = new Logger(BovedaService.name);
  private readonly llave: Buffer | null;
  private readonly anteriores: ReadonlyArray<Buffer>;

  constructor(
    @InjectRepository(Credencial) private readonly credenciales: Repository<Credencial>,
    @InjectRepository(AccesoPortal) private readonly accesos: Repository<AccesoPortal>,
    @Inject(ENV) env: Env,
  ) {
    this.llave = env.CREDENCIALES_LLAVE ? Buffer.from(env.CREDENCIALES_LLAVE, 'base64') : null;
    this.anteriores = env.CREDENCIALES_LLAVES_ANTERIORES.map((llave) => Buffer.from(llave, 'base64'));
    if ([this.llave, ...this.anteriores].some((llave) => llave !== null && llave.length !== BYTES_LLAVE)) {
      throw new Error('Las llaves de credenciales deben ser de 32 bytes en base64');
    }
  }

  /** Falla de inmediato si la boveda no tiene llave, antes de tocar nada mas. */
  exigirConfigurada(): void {
    this.exigirLlave();
  }

  async guardar(tramiteId: string, credencial: CredencialPortal): Promise<void> {
    const llave = this.exigirLlave();
    await this.credenciales.save({
      tramiteId,
      usuario: cifrar(llave, credencial.usuario, `${tramiteId}:usuario`),
      clave: cifrar(llave, credencial.clave, `${tramiteId}:clave`),
    });
    this.logger.log(`Credencial guardada para el tramite ${tramiteId}`);
  }

  async leer(tramiteId: string): Promise<CredencialPortal | null> {
    const guardada = await this.credenciales.findOneBy({ tramiteId });
    if (!guardada) return null;
    const actual = this.exigirLlave();
    for (const llave of [actual, ...this.anteriores]) {
      try {
        const credencial = {
          usuario: descifrar(llave, guardada.usuario, `${tramiteId}:usuario`),
          clave: descifrar(llave, guardada.clave, `${tramiteId}:clave`),
        };
        // Lo cifrado con una llave anterior se vuelve a guardar con la actual.
        if (llave !== actual) await this.guardar(tramiteId, credencial);
        return credencial;
      } catch {
        continue;
      }
    }
    throw new CredencialIlegibleError();
  }

  existe(tramiteId: string): Promise<boolean> {
    return this.credenciales.existsBy({ tramiteId });
  }

  async eliminar(tramiteId: string): Promise<boolean> {
    const eliminada = Boolean((await this.credenciales.delete({ tramiteId })).affected);
    if (eliminada) this.logger.log(`Credencial eliminada del tramite ${tramiteId}`);
    return eliminada;
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
