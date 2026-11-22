import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ENV, Env } from '../config/env';
import { BuzonService } from '../correo/buzon.service';
import { EventosService } from '../notificaciones/eventos.service';
import { MonitorService } from './monitor.service';

/** Tareas automaticas. Cada una se salta si la anterior del mismo tipo no ha terminado. */
@Injectable()
export class Planificador {
  private readonly logger = new Logger(Planificador.name);
  private readonly enCurso = new Set<string>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly monitor: MonitorService,
    private readonly eventos: EventosService,
    private readonly buzon: BuzonService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  revisarTramites(): Promise<void> {
    return this.ejecutar('revision', () => this.monitor.revisarPendientes());
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  entregarAvisos(): Promise<void> {
    return this.ejecutar('entrega', () => this.eventos.entregarPendientes());
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  leerBuzon(): Promise<void> {
    return this.ejecutar('buzon', () => this.buzon.sincronizar());
  }

  @Cron('0 7 * * 1-6', { timeZone: 'America/Bogota' })
  avisarTerminos(): Promise<void> {
    return this.ejecutar('terminos', () => this.monitor.avisarTerminos());
  }

  async ejecutar(nombre: string, tarea: () => Promise<unknown>): Promise<void> {
    if (!this.env.SCHEDULER_ENABLED || this.enCurso.has(nombre)) return;
    this.enCurso.add(nombre);
    try {
      await tarea();
    } catch (error) {
      this.logger.error(`Fallo la tarea ${nombre}: ${error instanceof Error ? error.message : 'error'}`);
    } finally {
      this.enCurso.delete(nombre);
    }
  }
}
