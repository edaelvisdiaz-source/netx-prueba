import { BadGatewayException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentosService } from '../documentos/documentos.service';
import { Tramite } from '../tramites/tramite.entity';
import { TramitesService } from '../tramites/tramites.service';
import { hoyEnColombia } from '../terminos/dias-habiles';
import { DocumentoParaResumen, ResumenCaso, ResumidorDeCasos } from './resumen-caso';

/** La API recibe hasta 32 MB por peticion y el archivo crece un tercio al codificarlo. */
const BYTES_MAXIMOS_POR_RESUMEN = 18 * 1024 * 1024;
const DOCUMENTOS_MAXIMOS_POR_RESUMEN = 8;
/** Cada resumen ocupa memoria y cuesta dinero: pocos a la vez y nunca dos del mismo caso. */
const RESUMENES_SIMULTANEOS = 2;

@Injectable()
export class ResumenCasoService {
  constructor(
    @InjectRepository(Tramite) private readonly tramites: Repository<Tramite>,
    private readonly tramitesService: TramitesService,
    private readonly documentos: DocumentosService,
    private readonly resumidor: ResumidorDeCasos,
  ) {}

  get activo(): boolean {
    return this.resumidor.activo;
  }

  private readonly enCurso = new Set<string>();

  /** Redacta el resumen con las actuaciones y los documentos mas recientes que quepan, y lo guarda. */
  async generar(tramiteId: string): Promise<ResumenCaso> {
    if (!this.resumidor.activo) throw new ServiceUnavailableException('El resumen con IA no esta configurado');
    if (this.enCurso.has(tramiteId)) throw new ConflictException('Ya se esta redactando el resumen de este caso; espera a que termine');
    if (this.enCurso.size >= RESUMENES_SIMULTANEOS) throw new ServiceUnavailableException('Hay otros resumenes en curso; intenta de nuevo en un minuto');
    this.enCurso.add(tramiteId);
    try {
      return await this.redactar(tramiteId);
    } finally {
      this.enCurso.delete(tramiteId);
    }
  }

  private async redactar(tramiteId: string): Promise<ResumenCaso> {
    const { tramite, actuaciones, situacion } = await this.tramitesService.detalle(tramiteId);
    const fichas = this.documentos.activo ? await this.documentos.listar(tramiteId) : [];
    const leidos: Array<DocumentoParaResumen & { id: string }> = [];
    let bytes = 0;
    for (const ficha of fichas) {
      if (leidos.length >= DOCUMENTOS_MAXIMOS_POR_RESUMEN || bytes + ficha.bytes > BYTES_MAXIMOS_POR_RESUMEN) continue;
      const { contenido } = await this.documentos.abrir(ficha.id);
      leidos.push({ id: ficha.id, nombre: ficha.nombre, tipo: ficha.tipo, origen: ficha.origen, contenido });
      bytes += ficha.bytes;
    }
    const redactado = await this.resumidor.resumir({
      tipoTramite: tramite.tipo,
      despacho: tramite.despacho,
      partes: tramite.sujetos,
      fechaRadicacion: tramite.fechaRadicacion,
      etapa: situacion.etapa,
      hoy: hoyEnColombia(),
      actuaciones: [...actuaciones].reverse().map(({ fecha, titulo, anotacion }) => ({ fecha, titulo, anotacion })),
      // Del mas antiguo al mas reciente, como se lee un expediente.
      documentos: [...leidos].reverse(),
    });
    if (!redactado) throw new BadGatewayException('La IA no pudo redactar el resumen; intenta de nuevo en unos minutos');
    const resumen: ResumenCaso = {
      ...redactado,
      generadoAt: new Date().toISOString(),
      actuaciones: actuaciones.length,
      documentosLeidos: leidos.map(({ id, nombre }) => ({ id, nombre })),
      documentosOmitidos: fichas.length - leidos.length,
    };
    await this.tramites.update({ id: tramiteId }, { resumenIa: resumen });
    return resumen;
  }
}
