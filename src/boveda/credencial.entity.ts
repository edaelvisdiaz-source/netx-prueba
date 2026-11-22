import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Usuario y clave del portal para un tramite. Ambos se guardan cifrados. */
@Entity('credenciales')
export class Credencial {
  @PrimaryColumn({ name: 'tramite_id', type: 'uuid' }) tramiteId!: string;
  @Column({ type: 'text' }) usuario!: string;
  @Column({ type: 'text' }) clave!: string;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** Bitacora: cada vez que Radika entra a un portal con la credencial de un cliente. */
@Entity('accesos_portal')
export class AccesoPortal {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tramite_id', type: 'uuid' }) tramiteId!: string;
  @Column({ type: 'text' }) fuente!: string;
  @Column({ type: 'text' }) resultado!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
