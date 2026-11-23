import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyGuard } from './auth/api-key.guard';
import { FiltroErrores } from './common/respuesta';
import { BovedaService } from './boveda/boveda.service';
import { AccesoPortal, Credencial } from './boveda/credencial.entity';
import { cargarEnv, ENV, Env } from './config/env';
import { Buzon, CorreoPendiente } from './correo/buzon.entity';
import { BuzonService } from './correo/buzon.service';
import { ImapLectorBuzon } from './correo/imap.lector-buzon';
import { LectorBuzon } from './correo/lector-buzon';
import { Buzon1700000000001 } from './migrations/1700000000001-buzon';
import { PORTALES } from './fuentes/fuente-portal';
import { FuentesRegistry } from './fuentes/fuentes.registry';
import { Portales1700000000002 } from './migrations/1700000000002-portales';
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
import { Usuarios1700000000003 } from './migrations/1700000000003-usuarios';
import { Etapas1700000000004 } from './migrations/1700000000004-etapas';
import { Reclasificar1700000000005 } from './migrations/1700000000005-reclasificar';
import { CarpetasBuzon1700000000006 } from './migrations/1700000000006-carpetas-buzon';
import { EtapaEventos1700000000007 } from './migrations/1700000000007-etapa-eventos';
import { SesionController } from './usuarios/sesion.controller';
import { Sesion, Usuario } from './usuarios/usuario.entity';
import { UsuariosService } from './usuarios/usuarios.service';
import { TramitesController } from './tramites/tramites.controller';
import { TramitesService } from './tramites/tramites.service';

const PETICIONES_POR_MINUTO = 120;
const VENTANA_MS = 60_000;
const ENTIDADES = [Tramite, Actuacion, Evento, Buzon, CorreoPendiente, Credencial, AccesoPortal, Usuario, Sesion];

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
        migrations: [Inicial1700000000000, Buzon1700000000001, Portales1700000000002, Usuarios1700000000003, Etapas1700000000004, Reclasificar1700000000005, CarpetasBuzon1700000000006, EtapaEventos1700000000007],
        migrationsRun: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature(ENTIDADES),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: VENTANA_MS, limit: PETICIONES_POR_MINUTO }]),
  ],
  controllers: [TramitesController, SesionController],
  providers: [
    { provide: HTTP_FETCH, useValue: fetch },
    { provide: APP_FILTER, useClass: FiltroErrores },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: CLIENTE_ANTHROPIC, inject: [ENV], useFactory: crearClienteAnthropic },
    { provide: Resumidor, useClass: ClaudeResumidor },
    // Los lectores de portales con inicio de sesion se agregan a esta lista cuando existan.
    { provide: PORTALES, useValue: [] },
    BovedaService,
    UsuariosService,
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
