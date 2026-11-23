import { MigrationInterface, QueryRunner } from 'typeorm';
import { clasificarActuacion } from '../tramites/clasificacion';

interface Fila { id: string; titulo: string; anotacion: string | null; categoria: string }

/**
 * Las reglas de clasificacion mejoraron con titulos reales de los despachos. Se vuelven a aplicar a
 * las actuaciones traidas de la Rama Judicial (su clave es "idProceso:idActuacion"); las registradas
 * a mano o por correo no se tocan.
 */
export class Reclasificar1700000000005 implements MigrationInterface {
  name = 'Reclasificar1700000000005';

  async up(runner: QueryRunner): Promise<void> {
    const filas: Fila[] = await runner.query(
      `SELECT id, titulo, anotacion, categoria FROM actuaciones WHERE clave_fuente ~ '^[0-9]+:[0-9]+$'`,
    );
    for (const fila of filas) {
      const categoria = clasificarActuacion(fila.titulo, fila.anotacion);
      if (categoria !== fila.categoria) await runner.query(`UPDATE actuaciones SET categoria = $1 WHERE id = $2`, [categoria, fila.id]);
    }
  }

  async down(): Promise<void> {
    // No hay vuelta atras util: la clasificacion anterior era menos precisa.
  }
}
