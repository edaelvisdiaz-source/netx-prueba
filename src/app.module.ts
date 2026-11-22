import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyGuard } from './auth/api-key.guard';
import { FiltroErrores } from './common/respuesta';
import { cargarEnv, ENV, Env } from './config/env';
import { Buzon, CorreoPendiente } from './correo/buzon.entity';
import { BuzonService } from './correo/buzon.service';
import { ImapLectorBuzon } from './correo/imap.lector-buzon';
import { LectorBuzon } from './correo/lector-buzon';
import { Buzon1700000000001 } from './migrations/1700000000001-buzon';
import { FuentesRegistry } from './fuentes/fuentes.registry';
import { HTTP_FETCH, RamaJudicialFuente } from './fuentes/rama-judicial.fuente';
import { Inicial1700000000000 } from './migrations/1700000000000-inicial';
import { MonitorService } from './monitor/monitor.service';
import { Planificador } from './monitor/planificador';
import { Evento } from './notificaciones/evento.entity';
import { EventosService } from './notificaciones/eventos.service';
import { ClaudeResumidor, CLIENTE_ANTHROPIC, crearClienteAnthropic } from './resumen/claude.resumidor';
import { Resumidor } from './resumen/resumidor';
import { Actuacion } from './tramites/actuacion.entity';
import { Tramite } from './tramites/tramite.entity';
import { TramitesController } from './tramites/tramites.controller';
import { TramitesService } from './tramites/tramites.service';

const PETICIONES_POR_MINUTO = 120;
const VENTANA_MS = 60_000;
const ENTIDADES = [Tramite, Actuacion, Evento, Buzon, CorreoPendiente];

@Module({
  providers: [{ provide: ENV, useFactory: () => cargarEnv() }],
  exports: [ENV],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV],
      useFactory: (env: Env) => ({
        type: 'postgres' as const,
        url: env.DATABASE_URL,
        entities: ENTIDADES,
        migrations: [Inicial1700000000000, Buzon1700000000001],
        migrationsRun: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature(ENTIDADES),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: VENTANA_MS, limit: PETICIONES_POR_MINUTO }]),
  ],
  controllers: [TramitesController],
  providers: [
    { provide: HTTP_FETCH, useValue: fetch },
    { provide: APP_FILTER, useClass: FiltroErrores },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: CLIENTE_ANTHROPIC, inject: [ENV], useFactory: crearClienteAnthropic },
    { provide: Resumidor, useClass: ClaudeResumidor },
    RamaJudicialFuente,
    FuentesRegistry,
    TramitesService,
    EventosService,
    MonitorService,
    { provide: LectorBuzon, useClass: ImapLectorBuzon },
    BuzonService,
    Planificador,
  ],
})
export class AppModule {}
