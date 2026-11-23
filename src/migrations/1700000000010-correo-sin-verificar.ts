import { MigrationInterface, QueryRunner } from 'typeorm';

/** Nuevo motivo para un correo pendiente: dice venir de un juzgado, pero el servidor de correo no lo comprobo. */
export class CorreoSinVerificar1700000000010 implements MigrationInterface {
  name = 'CorreoSinVerificar1700000000010';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE correos_pendientes DROP CONSTRAINT correos_pendientes_motivo_check`);
    await runner.query(`ALTER TABLE correos_pendientes ADD CONSTRAINT correos_pendientes_motivo_check CHECK (motivo IN ('SIN_RADICADO','SIN_TRAMITE','AMBIGUO','SIN_VERIFICAR'))`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DELETE FROM correos_pendientes WHERE motivo = 'SIN_VERIFICAR'`);
    await runner.query(`ALTER TABLE correos_pendientes DROP CONSTRAINT correos_pendientes_motivo_check`);
    await runner.query(`ALTER TABLE correos_pendientes ADD CONSTRAINT correos_pendientes_motivo_check CHECK (motivo IN ('SIN_RADICADO','SIN_TRAMITE','AMBIGUO'))`);
  }
}
