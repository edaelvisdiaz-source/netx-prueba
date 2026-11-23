import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { ENV, Env } from '../config/env';

/** Donde se guarda el contenido de los documentos. Privado: solo Radika lee y escribe. */
export abstract class AlmacenDocumentos {
  /** `false` si no hay almacen configurado; entonces no se aceptan documentos. */
  abstract readonly activo: boolean;
  abstract guardar(clave: string, contenido: Buffer, tipo: string): Promise<void>;
  abstract leer(clave: string): Promise<Buffer>;
  abstract eliminar(clave: string): Promise<void>;
}

/* istanbul ignore next -- habla con S3 o con el disco; se comprueba al desplegar */
@Injectable()
export class AlmacenConfigurado extends AlmacenDocumentos {
  readonly activo: boolean;
  private readonly s3: S3Client | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
    this.s3 = env.DOCUMENTOS_BUCKET ? new S3Client({}) : null;
    this.activo = Boolean(env.DOCUMENTOS_BUCKET || env.DOCUMENTOS_DIR);
  }

  private ruta(clave: string): string {
    const base = resolve(this.env.DOCUMENTOS_DIR ?? '');
    const destino = resolve(join(base, clave));
    if (!destino.startsWith(base + sep)) throw new Error('Clave de documento invalida');
    return destino;
  }

  async guardar(clave: string, contenido: Buffer, tipo: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.env.DOCUMENTOS_BUCKET, Key: clave, Body: contenido, ContentType: tipo, ServerSideEncryption: 'AES256' }));
      return;
    }
    await mkdir(dirname(this.ruta(clave)), { recursive: true });
    await writeFile(this.ruta(clave), contenido);
  }

  async leer(clave: string): Promise<Buffer> {
    if (!this.s3) return readFile(this.ruta(clave));
    const respuesta = await this.s3.send(new GetObjectCommand({ Bucket: this.env.DOCUMENTOS_BUCKET, Key: clave }));
    if (!respuesta.Body) throw new Error('El almacen devolvio un documento vacio');
    return Buffer.from(await respuesta.Body.transformToByteArray());
  }

  async eliminar(clave: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.env.DOCUMENTOS_BUCKET, Key: clave }));
      return;
    }
    await rm(this.ruta(clave), { force: true });
  }
}
