import { MigrationInterface, QueryRunner } from 'typeorm';

/** Etapa fijada a mano y nota libre del asesor. La etapa automatica se calcula al leer. */
export class Etapas1700000000004 implements MigrationInterface {
  name = 'Etapas1700000000004';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE tramites ADD COLUMN etapa_manual text, ADD COLUMN etapa_manual_at timestamptz, ADD COLUMN nota text`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE tramites DROP COLUMN etapa_manual, DROP COLUMN etapa_manual_at, DROP COLUMN nota`);
  }
}
