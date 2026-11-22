import { MigrationInterface, QueryRunner } from 'typeorm';

export class Usuarios1700000000003 implements MigrationInterface {
  name = 'Usuarios1700000000003';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE usuarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        nombre text NOT NULL,
        rol text NOT NULL CHECK (rol IN ('ADMIN','ASESOR')),
        huella_clave text NOT NULL,
        debe_cambiar_clave boolean NOT NULL DEFAULT true,
        activo boolean NOT NULL DEFAULT true,
        intentos_fallidos int NOT NULL DEFAULT 0,
        bloqueado_hasta timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await runner.query(`
      CREATE TABLE sesiones (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        huella_token text NOT NULL UNIQUE,
        usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        expira_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await runner.query(`CREATE INDEX ix_sesiones_usuario ON sesiones (usuario_id)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE sesiones`);
    await runner.query(`DROP TABLE usuarios`);
  }
}
