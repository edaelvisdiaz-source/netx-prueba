import { MigrationInterface, QueryRunner } from 'typeorm';

export class Inicial1700000000000 implements MigrationInterface {
  name = 'Inicial1700000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE tramites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo text NOT NULL CHECK (tipo IN ('TUTELA','PROCESO_JUDICIAL','CONVALIDACION_MEN','LEGALIZACION_MEN','SAC_MEN','APOSTILLA')),
        fuente text NOT NULL CHECK (fuente IN ('RAMA_JUDICIAL_CPNU','MANUAL')),
        radicado text NOT NULL,
        referencia_crm text,
        cliente_nombre text,
        estado text NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','PAUSADO','CERRADO')),
        despacho text,
        sujetos text,
        fecha_radicacion date,
        ultima_actuacion_fecha date,
        ultima_revision_at timestamptz,
        sincronizado_at timestamptz,
        proxima_revision_at timestamptz NOT NULL DEFAULT now(),
        ultimo_error text,
        errores_consecutivos int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await runner.query(`CREATE UNIQUE INDEX uq_tramites_fuente_radicado ON tramites (fuente, radicado)`);
    await runner.query(`CREATE INDEX ix_tramites_referencia_crm ON tramites (referencia_crm)`);
    await runner.query(`CREATE INDEX ix_tramites_pendientes ON tramites (proxima_revision_at) WHERE estado = 'ACTIVO' AND fuente <> 'MANUAL'`);
    await runner.query(`
      CREATE TABLE actuaciones (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tramite_id uuid NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
        clave_fuente text NOT NULL,
        despacho text,
        fecha date NOT NULL,
        titulo text NOT NULL,
        anotacion text,
        fecha_inicio_termino date,
        fecha_fin_termino date,
        fecha_registro date,
        categoria text NOT NULL CHECK (categoria IN ('ADMISION','FALLO','IMPUGNACION','DESACATO','REQUERIMIENTO','REMISION_CORTE','OTRA')),
        detectada_at timestamptz NOT NULL DEFAULT now()
      )`);
    await runner.query(`CREATE UNIQUE INDEX uq_actuaciones_tramite_clave ON actuaciones (tramite_id, clave_fuente)`);
    await runner.query(`CREATE INDEX ix_actuaciones_tramite_fecha ON actuaciones (tramite_id, fecha DESC)`);
    await runner.query(`
      CREATE TABLE eventos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tramite_id uuid NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
        tipo text NOT NULL CHECK (tipo IN ('TRAMITE_SINCRONIZADO','ACTUACION_NUEVA','TERMINO_POR_VENCER','TERMINO_VENCIDO','ERROR_FUENTE')),
        payload jsonb NOT NULL,
        estado text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','ENTREGADO','FALLIDO')),
        intentos int NOT NULL DEFAULT 0,
        proximo_intento_at timestamptz NOT NULL DEFAULT now(),
        entregado_at timestamptz,
        clave_dedupe text UNIQUE,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )`);
    await runner.query(`CREATE INDEX ix_eventos_pendientes ON eventos (estado, proximo_intento_at)`);
    await runner.query(`CREATE INDEX ix_eventos_created ON eventos (created_at, id)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE eventos`);
    await runner.query(`DROP TABLE actuaciones`);
    await runner.query(`DROP TABLE tramites`);
  }
}
