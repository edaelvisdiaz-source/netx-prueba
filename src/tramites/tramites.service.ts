import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, QueryFailedError, Repository } from 'typeorm';
import { hoyEnColombia } from '../terminos/dias-habiles';
import { calcularTerminosTutela, Termino } from '../terminos/tutela';
import { Actuacion } from './actuacion.entity';
import { ActualizarTramite, CrearTramite, ListarTramites } from './dto';
import { EnlaceConsulta, enlacesDeConsulta } from './enlaces';
import { normalizarRadicadoJudicial, normalizarRadicadoLibre } from './radicado';
import { esFuentePortal, esTipoJudicial, fuentePorDefecto, portalDe } from './tipos';
import { Tramite } from './tramite.entity';

const PG_VIOLACION_UNICA = '23505';

export interface DetalleTramite {
  readonly tramite: Tramite;
  readonly actuaciones: ReadonlyArray<Actuacion>;
  readonly terminos: ReadonlyArray<Termino>;
  readonly enlacesConsulta: ReadonlyArray<EnlaceConsulta>;
}

@Injectable()
export class TramitesService {
  constructor(
    @InjectRepository(Tramite) private readonly tramites: Repository<Tramite>,
    @InjectRepository(Actuacion) private readonly actuaciones: Repository<Actuacion>,
  ) {}

  async crear(datos: CrearTramite): Promise<Tramite> {
    const fuente = datos.fuente ?? fuentePorDefecto(datos.tipo);
    const esJudicial = fuente === 'RAMA_JUDICIAL_CPNU';
    if (esJudicial && !esTipoJudicial(datos.tipo)) {
      throw new BadRequestException('La Rama Judicial solo aplica a tutelas y procesos judiciales');
    }
    if (esFuentePortal(fuente) && fuente !== portalDe(datos.tipo)) {
      throw new BadRequestException('Esa fuente no corresponde al tipo de tramite');
    }
    const radicado = esJudicial
      ? normalizarRadicadoJudicial(datos.radicado)
      : normalizarRadicadoLibre(datos.radicado);
    if (radicado === null) {
      throw new BadRequestException(
        esJudicial ? 'El radicado judicial debe tener 23 digitos' : 'El radicado tiene caracteres no permitidos',
      );
    }
    try {
      return await this.tramites.save(
        this.tramites.create({
          tipo: datos.tipo,
          fuente,
          radicado,
          referenciaCrm: datos.referenciaCrm ?? null,
          clienteNombre: datos.clienteNombre ?? null,
          proximaRevisionAt: new Date(),
        }),
      );
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_VIOLACION_UNICA) {
        throw new ConflictException('Ese radicado ya esta registrado');
      }
      throw error;
    }
  }

  async listar(filtros: ListarTramites): Promise<{ items: Tramite[]; total: number }> {
    const where: FindOptionsWhere<Tramite> = {
      ...(filtros.referenciaCrm ? { referenciaCrm: filtros.referenciaCrm } : {}),
      ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
      ...(filtros.estado ? { estado: filtros.estado } : {}),
    };
    const [items, total] = await this.tramites.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'ASC' },
      skip: (filtros.page - 1) * filtros.limit,
      take: filtros.limit,
    });
    return { items, total };
  }

  async obtener(id: string): Promise<Tramite> {
    const tramite = await this.tramites.findOneBy({ id });
    if (!tramite) throw new NotFoundException('Tramite no encontrado');
    return tramite;
  }

  async detalle(id: string): Promise<DetalleTramite> {
    const tramite = await this.obtener(id);
    const actuaciones = await this.actuaciones.find({
      where: { tramiteId: id },
      order: { fecha: 'DESC', detectadaAt: 'DESC' },
    });
    const terminos =
      tramite.tipo === 'TUTELA'
        ? calcularTerminosTutela({ fechaRadicacion: tramite.fechaRadicacion, actuaciones, hoy: hoyEnColombia() })
        : [];
    return { tramite, actuaciones, terminos, enlacesConsulta: enlacesDeConsulta(tramite.tipo, tramite.radicado) };
  }

  async actualizar(id: string, cambios: ActualizarTramite): Promise<Tramite> {
    const actual = await this.obtener(id);
    const reactivado = cambios.estado === 'ACTIVO' && actual.estado !== 'ACTIVO';
    await this.tramites.update({ id }, { ...cambios, ...(reactivado ? { proximaRevisionAt: new Date() } : {}) });
    return this.obtener(id);
  }

  /** Al registrar la credencial, un tramite del Ministerio pasa a revisarse solo en su portal. */
  async exigirTipoConPortal(id: string): Promise<void> {
    if (portalDe((await this.obtener(id)).tipo) === null) {
      throw new BadRequestException('Este tipo de tramite no se consulta con usuario y clave');
    }
  }

  async activarPortal(id: string): Promise<void> {
    const fuente = portalDe((await this.obtener(id)).tipo);
    if (fuente === null) return;
    await this.tramites.update(
      { id },
      { fuente, proximaRevisionAt: new Date(), credencialRechazada: false, ultimoError: null, erroresConsecutivos: 0 },
    );
  }

  async eliminar(id: string): Promise<void> {
    const resultado = await this.tramites.delete({ id });
    if (!resultado.affected) throw new NotFoundException('Tramite no encontrado');
  }
}
