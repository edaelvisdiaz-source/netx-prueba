import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cada actuacion recuerda de que instancia del proceso viene (0 la primera, 1 la segunda...).
 * Queda vacia en las que no vienen de la consulta judicial (correo, registro manual).
 */
export class Instancias1700000000009 implements MigrationInterface {
  name = 'Instancias1700000000009';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE actuaciones ADD COLUMN instancia smallint`);
    // Hasta ahora cada tramite solo traia la instancia de su propio radicado.
    await runner.query(`
      UPDATE actuaciones a SET instancia = right(t.radicado, 2)::smallint
      FROM tramites t
      WHERE t.id = a.tramite_id AND t.fuente = 'RAMA_JUDICIAL_CPNU' AND t.radicado ~ '^[0-9]{23}$' AND a.clave_fuente ~ '^[0-9]+:[0-9]+$'`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE actuaciones DROP COLUMN instancia`);
  }
}
