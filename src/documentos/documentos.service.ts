import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AlmacenDocumentos } from './almacen';
import { Documento, OrigenDocumento } from './documento.entity';

export const BYTES_MAXIMOS_DOCUMENTO = 15 * 1024 * 1024;
const LARGO_MAXIMO_NOMBRE = 200;
const DOCUMENTOS_POR_TRAMITE = 200;

const FIRMAS: ReadonlyArray<{ readonly tipo: string; readonly inicio: Buffer }> = [
  { tipo: 'application/pdf', inicio: Buffer.from('%PDF-') },
  { tipo: 'image/png', inicio: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { tipo: 'image/jpeg', inicio: Buffer.from([0xff, 0xd8, 0xff]) },
];

/** Tipo real del archivo segun sus primeros bytes; no se confia en la extension ni en lo que diga quien lo envia. */
export function tipoPorContenido(contenido: Buffer): string | null {
  return FIRMAS.find(({ inicio }) => contenido.subarray(0, inicio.length).equals(inicio))?.tipo ?? null;
}

/** Nombre apto para mostrar y para un encabezado HTTP: sin rutas ni caracteres de control. */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).at(-1)?.trim() ?? '';
  return (limpio || 'documento').slice(0, LARGO_MAXIMO_NOMBRE);
}

export interface NuevoDocumento {
  readonly nombre: string;
  readonly contenido: Buffer;
  readonly origen: OrigenDocumento;
  readonly actuacionId?: string | null;
}

@Injectable()
export class DocumentosService {
  private readonly logger = new Logger(DocumentosService.name);

  constructor(
    @InjectRepository(Documento) private readonly documentos: Repository<Documento>,
    private readonly almacen: AlmacenDocumentos,
  ) {}

  get activo(): boolean {
    return this.almacen.activo;
  }

  /** Guarda el archivo. Si ese mismo archivo ya estaba en el tramite, devuelve el existente. */
  async agregar(tramiteId: string, nuevo: NuevoDocumento): Promise<Documento> {
    if (!this.almacen.activo) throw new ServiceUnavailableException('El almacen de documentos no esta configurado');
    if (nuevo.contenido.length === 0) throw new BadRequestException('El archivo esta vacio');
    if (nuevo.contenido.length > BYTES_MAXIMOS_DOCUMENTO) throw new BadRequestException('El archivo supera los 15 MB');
    const tipo = tipoPorContenido(nuevo.contenido);
    if (!tipo) throw new BadRequestException('Solo se aceptan archivos PDF, PNG o JPG');
    const sha256 = createHash('sha256').update(nuevo.contenido).digest('hex');
    const existente = await this.documentos.findOneBy({ tramiteId, sha256 });
    if (existente) return existente;
    if ((await this.documentos.countBy({ tramiteId })) >= DOCUMENTOS_POR_TRAMITE) {
      throw new BadRequestException('Este tramite ya tiene el maximo de documentos');
    }
    const clave = `tramites/${tramiteId}/${randomUUID()}`;
    await this.almacen.guardar(clave, nuevo.contenido, tipo);
    try {
      const guardado = await this.documentos.save(
        this.documentos.create({
          tramiteId, actuacionId: nuevo.actuacionId ?? null, origen: nuevo.origen, nombre: nombreSeguro(nuevo.nombre),
          tipo, bytes: nuevo.contenido.length, sha256, clave,
        }),
      );
      return this.ficha(guardado.id);
    } catch (error) {
      // Sin ficha, el archivo quedaria huerfano en el almacen.
      await this.almacen.eliminar(clave).catch(() => undefined);
      const repetido = await this.documentos.findOneBy({ tramiteId, sha256 });
      if (repetido) return repetido;
      throw error;
    }
  }

  listar(tramiteId: string): Promise<Documento[]> {
    return this.documentos.find({ where: { tramiteId }, order: { createdAt: 'DESC' } });
  }

  private async ficha(id: string): Promise<Documento> {
    const documento = await this.documentos.findOneBy({ id });
    if (!documento) throw new NotFoundException('Documento no encontrado');
    return documento;
  }

  private async clave(id: string): Promise<string> {
    const fila = await this.documentos.findOne({ where: { id }, select: { id: true, clave: true } });
    if (!fila) throw new NotFoundException('Documento no encontrado');
    return fila.clave;
  }

  async abrir(id: string): Promise<{ documento: Documento; contenido: Buffer }> {
    const documento = await this.ficha(id);
    return { documento, contenido: await this.almacen.leer(await this.clave(id)) };
  }

  async eliminar(id: string): Promise<void> {
    const clave = await this.clave(id);
    await this.documentos.delete({ id });
    await this.almacen.eliminar(clave).catch((error: unknown) => {
      this.logger.warn(`No se pudo borrar del almacen el documento ${id}: ${error instanceof Error ? error.message : 'error'}`);
    });
  }

  /** Antes de borrar un tramite: sus fichas caen en cascada, pero los archivos hay que quitarlos aparte. */
  async eliminarDeTramite(tramiteId: string): Promise<void> {
    for (const documento of await this.documentos.find({ where: { tramiteId }, select: { id: true } })) {
      await this.eliminar(documento.id);
    }
  }
}
