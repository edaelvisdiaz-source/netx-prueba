import { MigrationInterface, QueryRunner } from 'typeorm';

/** Fichas de los documentos de cada tramite y el resumen del caso redactado con IA. */
export class Documentos1700000000008 implements MigrationInterface {
  name = 'Documentos1700000000008';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE documentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tramite_id uuid NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
        actuacion_id uuid REFERENCES actuaciones(id) ON DELETE SET NULL,
        origen text NOT NULL CHECK (origen IN ('CORREO','MANUAL')),
        nombre text NOT NULL,
        tipo text NOT NULL,
        bytes int NOT NULL,
        sha256 text NOT NULL,
        clave text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await runner.query(`CREATE UNIQUE INDEX uq_documentos_tramite_huella ON documentos (tramite_id, sha256)`);
    await runner.query(`ALTER TABLE tramites ADD COLUMN resumen_ia jsonb`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE tramites DROP COLUMN resumen_ia`);
    await runner.query(`DROP TABLE documentos`);
  }
}
