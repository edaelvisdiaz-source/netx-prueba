import { MigrationInterface, QueryRunner } from 'typeorm';

/** Se guarda la ultima etapa conocida de cada tramite para avisar cuando cambia. */
export class EtapaEventos1700000000007 implements MigrationInterface {
  name = 'EtapaEventos1700000000007';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE tramites ADD COLUMN etapa text`);
    await runner.query(`ALTER TABLE eventos DROP CONSTRAINT eventos_tipo_check`);
    await runner.query(
      `ALTER TABLE eventos ADD CONSTRAINT eventos_tipo_check CHECK (tipo IN ('TRAMITE_SINCRONIZADO','ACTUACION_NUEVA','TERMINO_POR_VENCER','TERMINO_VENCIDO','ERROR_FUENTE','ETAPA_CAMBIADA'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DELETE FROM eventos WHERE tipo = 'ETAPA_CAMBIADA'`);
    await runner.query(`ALTER TABLE eventos DROP CONSTRAINT eventos_tipo_check`);
    await runner.query(
      `ALTER TABLE eventos ADD CONSTRAINT eventos_tipo_check CHECK (tipo IN ('TRAMITE_SINCRONIZADO','ACTUACION_NUEVA','TERMINO_POR_VENCER','TERMINO_VENCIDO','ERROR_FUENTE'))`,
    );
    await runner.query(`ALTER TABLE tramites DROP COLUMN etapa`);
  }
}
