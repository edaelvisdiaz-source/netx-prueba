import { MigrationInterface, QueryRunner } from 'typeorm';

export class Buzon1700000000001 implements MigrationInterface {
  name = 'Buzon1700000000001';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE buzones (
        direccion text PRIMARY KEY,
        uid_validity text NOT NULL,
        ultimo_uid int NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await runner.query(`
      CREATE TABLE correos_pendientes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        buzon text NOT NULL,
        message_id text NOT NULL,
        remitente text NOT NULL,
        remitente_nombre text,
        asunto text NOT NULL,
        fecha timestamptz NOT NULL,
        motivo text NOT NULL CHECK (motivo IN ('SIN_RADICADO','SIN_TRAMITE','AMBIGUO')),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await runner.query(`CREATE UNIQUE INDEX uq_correos_pendientes_mensaje ON correos_pendientes (buzon, message_id)`);
    await runner.query(`CREATE INDEX ix_correos_pendientes_fecha ON correos_pendientes (fecha DESC)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE correos_pendientes`);
    await runner.query(`DROP TABLE buzones`);
  }
}
