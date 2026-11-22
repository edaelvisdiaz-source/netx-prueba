import { MigrationInterface, QueryRunner } from 'typeorm';

export class Portales1700000000002 implements MigrationInterface {
  name = 'Portales1700000000002';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE tramites DROP CONSTRAINT tramites_fuente_check`);
    await runner.query(`ALTER TABLE tramites ADD CONSTRAINT tramites_fuente_check CHECK (fuente IN ('RAMA_JUDICIAL_CPNU','MANUAL','MEN_CONVALIDACION','MEN_LEGALIZACION'))`);
    await runner.query(`ALTER TABLE tramites ADD COLUMN estado_fuente text, ADD COLUMN estado_fuente_desde timestamptz, ADD COLUMN credencial_rechazada boolean NOT NULL DEFAULT false`);
    await runner.query(`
      CREATE TABLE credenciales (
        tramite_id uuid PRIMARY KEY REFERENCES tramites(id) ON DELETE CASCADE,
        usuario text NOT NULL,
        clave text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await runner.query(`
      CREATE TABLE accesos_portal (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tramite_id uuid NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
        fuente text NOT NULL,
        resultado text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )`);
    await runner.query(`CREATE INDEX ix_accesos_portal_tramite ON accesos_portal (tramite_id, created_at DESC)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE accesos_portal`);
    await runner.query(`DROP TABLE credenciales`);
    await runner.query(`ALTER TABLE tramites DROP COLUMN estado_fuente, DROP COLUMN estado_fuente_desde, DROP COLUMN credencial_rechazada`);
    await runner.query(`ALTER TABLE tramites DROP CONSTRAINT tramites_fuente_check`);
    await runner.query(`ALTER TABLE tramites ADD CONSTRAINT tramites_fuente_check CHECK (fuente IN ('RAMA_JUDICIAL_CPNU','MANUAL'))`);
  }
}
