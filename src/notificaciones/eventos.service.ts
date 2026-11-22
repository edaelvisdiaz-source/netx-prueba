import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { ENV, Env } from '../config/env';
import { FetchFn, HTTP_FETCH } from '../fuentes/rama-judicial.fuente';
import { Tramite } from '../tramites/tramite.entity';
import { Evento, TipoEvento } from './evento.entity';

const MAX_INTENTOS = 8;
const ESPERAS_MINUTOS: ReadonlyArray<number> = [1, 5, 30, 120, 720];
const LOTE_ENTREGA = 20;
const TIEMPO_LIMITE_WEBHOOK_MS = 10_000;
const MS_MINUTO = 60_000;

export interface NuevoEvento {
  readonly tramite: Tramite;
  readonly tipo: TipoEvento;
  readonly datos: Record<string, unknown>;
  readonly claveDedupe?: string;
}

/** Firma que el CRM debe recalcular para confirmar que el aviso viene de Radika. */
export function firmar(secreto: string, marcaDeTiempo: string, cuerpo: string): string {
  return `sha256=${createHmac('sha256', secreto).update(`${marcaDeTiempo}.${cuerpo}`).digest('hex')}`;
}

@Injectable()
export class EventosService {
  private readonly logger = new Logger(EventosService.name);

  constructor(
    @InjectRepository(Evento) private readonly eventos: Repository<Evento>,
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly fetchFn: FetchFn,
  ) {}

  /** Guarda el evento dentro de la misma transaccion que el cambio que lo origina. */
  async registrar(em: EntityManager, nuevo: NuevoEvento): Promise<void> {
    const { tramite } = nuevo;
    await em
      .createQueryBuilder()
      .insert()
      .into(Evento)
      .values({
        tramiteId: tramite.id,
        tipo: nuevo.tipo,
        claveDedupe: nuevo.claveDedupe ?? null,
        proximoIntentoAt: new Date(),
        payload: {
          tramite: {
            id: tramite.id,
            tipo: tramite.tipo,
            radicado: tramite.radicado,
            referenciaCrm: tramite.referenciaCrm,
            clienteNombre: tramite.clienteNombre,
          },
          datos: nuevo.datos,
        },
      })
      .orIgnore()
      .execute();
  }

  /** Para que el CRM pueda pedir las novedades si prefiere no recibir avisos. */
  async listar(cursor: string | undefined, limite: number): Promise<{ items: Evento[]; siguiente: string | null }> {
    const consulta = this.eventos
      .createQueryBuilder('e')
      .orderBy(`date_trunc('milliseconds', e.created_at)`, 'ASC')
      .addOrderBy('e.id', 'ASC')
      .take(limite);
    if (cursor) {
      const [fecha, id] = cursor.split('_');
      consulta.where(`(date_trunc('milliseconds', e.created_at), e.id) > (:fecha::timestamptz, :id::uuid)`, { fecha, id });
    }
    const items = await consulta.getMany();
    const ultimo = items.at(-1);
    return { items, siguiente: ultimo ? `${ultimo.createdAt.toISOString()}_${ultimo.id}` : null };
  }

  /** Entrega al CRM los eventos pendientes. Devuelve cuantos quedaron entregados. */
  async entregarPendientes(): Promise<number> {
    if (!this.env.CRM_WEBHOOK_URL || !this.env.CRM_WEBHOOK_SECRET) return 0;
    const pendientes = await this.eventos.find({
      where: { estado: 'PENDIENTE', proximoIntentoAt: LessThanOrEqual(new Date()) },
      order: { createdAt: 'ASC' },
      take: LOTE_ENTREGA,
    });
    let entregados = 0;
    for (const evento of pendientes) {
      const exito = await this.enviar(evento, this.env.CRM_WEBHOOK_URL, this.env.CRM_WEBHOOK_SECRET);
      const intentos = evento.intentos + 1;
      if (exito) {
        entregados += 1;
        await this.eventos.update({ id: evento.id }, { estado: 'ENTREGADO', intentos, entregadoAt: new Date() });
        continue;
      }
      const espera = ESPERAS_MINUTOS[Math.min(intentos - 1, ESPERAS_MINUTOS.length - 1)];
      await this.eventos.update(
        { id: evento.id },
        {
          estado: intentos >= MAX_INTENTOS ? 'FALLIDO' : 'PENDIENTE',
          intentos,
          proximoIntentoAt: new Date(Date.now() + espera * MS_MINUTO),
        },
      );
    }
    return entregados;
  }

  private async enviar(evento: Evento, url: string, secreto: string): Promise<boolean> {
    const cuerpo = JSON.stringify({
      id: evento.id,
      tipo: evento.tipo,
      creadoEn: evento.createdAt.toISOString(),
      ...evento.payload,
    });
    const marcaDeTiempo = String(Math.floor(Date.now() / 1000));
    try {
      const respuesta = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-radika-event-id': evento.id,
          'x-radika-timestamp': marcaDeTiempo,
          'x-radika-signature': firmar(secreto, marcaDeTiempo, cuerpo),
        },
        body: cuerpo,
        signal: AbortSignal.timeout(TIEMPO_LIMITE_WEBHOOK_MS),
        redirect: 'error',
      });
      if (!respuesta.ok) this.logger.warn(`El CRM respondio ${respuesta.status} al evento ${evento.id}`);
      return respuesta.ok;
    } catch (error) {
      this.logger.warn(`No se pudo entregar el evento ${evento.id}: ${error instanceof Error ? error.name : 'Error'}`);
      return false;
    }
  }
}
