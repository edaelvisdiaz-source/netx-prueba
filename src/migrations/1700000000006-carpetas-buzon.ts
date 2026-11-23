import { MigrationInterface, QueryRunner } from 'typeorm';

/** El buzon se vigila por carpetas, y un correo pendiente puede traer el radicado que Radika encontro. */
export class CarpetasBuzon1700000000006 implements MigrationInterface {
  name = 'CarpetasBuzon1700000000006';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE buzones ADD COLUMN carpeta text NOT NULL DEFAULT 'INBOX'`);
    await runner.query(`ALTER TABLE buzones DROP CONSTRAINT buzones_pkey, ADD PRIMARY KEY (direccion, carpeta)`);
    await runner.query(`ALTER TABLE buzones ALTER COLUMN carpeta DROP DEFAULT`);
    await runner.query(`ALTER TABLE correos_pendientes ADD COLUMN radicado_sugerido text, ADD COLUMN carpeta text`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE correos_pendientes DROP COLUMN radicado_sugerido, DROP COLUMN carpeta`);
    await runner.query(`DELETE FROM buzones WHERE carpeta <> 'INBOX'`);
    await runner.query(`ALTER TABLE buzones DROP CONSTRAINT buzones_pkey, ADD PRIMARY KEY (direccion)`);
    await runner.query(`ALTER TABLE buzones DROP COLUMN carpeta`);
  }
}
