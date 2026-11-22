import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ENV, Env } from '../config/env';
import { MonitorService } from '../monitor/monitor.service';
import { esRemitenteConfiable } from './analizar-correo';
import { Buzon, CorreoPendiente } from './buzon.entity';
import { LectorBuzon } from './lector-buzon';

const CORREOS_POR_TANDA = 200;
const PENDIENTES_POR_PAGINA = 100;

export interface ResultadoBuzon {
  readonly leidos: number;
  readonly vinculados: number;
  readonly pendientes: number;
}

const SIN_NOVEDAD: ResultadoBuzon = { leidos: 0, vinculados: 0, pendientes: 0 };

/** Vigila el buzon y entrega a Radika los correos de los despachos. */
@Injectable()
export class BuzonService {
  private readonly logger = new Logger(BuzonService.name);

  constructor(
    @InjectRepository(Buzon) private readonly buzones: Repository<Buzon>,
    @InjectRepository(CorreoPendiente) private readonly pendientes: Repository<CorreoPendiente>,
    @Inject(ENV) private readonly env: Env,
    private readonly lector: LectorBuzon,
    private readonly monitor: MonitorService,
  ) {}

  async sincronizar(): Promise<ResultadoBuzon> {
    const direccion = this.lector.buzon;
    if (direccion === null) return SIN_NOVEDAD;
    const estado = await this.buzones.findOneBy({ direccion });
    const lectura = await this.lector.leerDesde(estado?.ultimoUid ?? Number.MAX_SAFE_INTEGER, CORREOS_POR_TANDA);

    // Primera vez (o el servidor renumero el buzon): se toma el punto de partida sin procesar el historial.
    if (!estado || estado.uidValidity !== lectura.uidValidity) {
      await this.buzones.save({ direccion, uidValidity: lectura.uidValidity, ultimoUid: lectura.uidMaximo });
      this.logger.log(`Buzon ${direccion}: se leera a partir del correo ${lectura.uidMaximo + 1}`);
      return SIN_NOVEDAD;
    }

    let vinculados = 0;
    let pendientes = 0;
    let ultimoUid = estado.ultimoUid;
    for (const correo of lectura.correos) {
      if (esRemitenteConfiable(correo.from, this.env.CORREO_DOMINIOS_CONFIABLES)) {
        const resultado = await this.monitor.registrarCorreo({
          messageId: correo.messageId,
          from: correo.from,
          fromNombre: correo.fromNombre ?? undefined,
          subject: correo.subject,
          date: correo.date,
          adjuntos: [...correo.adjuntos],
        });
        if (resultado.vinculado) {
          vinculados += 1;
        } else if (resultado.motivo !== 'REMITENTE_NO_CONFIABLE') {
          pendientes += 1;
          await this.pendientes
            .createQueryBuilder()
            .insert()
            .values({
              buzon: direccion,
              messageId: correo.messageId,
              remitente: correo.from,
              remitenteNombre: correo.fromNombre,
              asunto: correo.subject,
              fecha: new Date(correo.date),
              motivo: resultado.motivo,
            })
            .orIgnore()
            .execute();
        }
      }
      ultimoUid = correo.uid;
      await this.buzones.update({ direccion }, { ultimoUid });
    }
    // Si el tramo leido no traia correos (por ejemplo, fueron borrados), se avanza igual.
    const alcanzado = Math.min(lectura.uidMaximo, estado.ultimoUid + CORREOS_POR_TANDA);
    if (alcanzado > ultimoUid) await this.buzones.update({ direccion }, { ultimoUid: alcanzado });
    return { leidos: lectura.correos.length, vinculados, pendientes };
  }

  listarPendientes(): Promise<CorreoPendiente[]> {
    return this.pendientes.find({ order: { fecha: 'DESC' }, take: PENDIENTES_POR_PAGINA });
  }

  async descartarPendiente(id: string): Promise<void> {
    const resultado = await this.pendientes.delete({ id });
    if (!resultado.affected) throw new NotFoundException('Correo pendiente no encontrado');
  }
}
