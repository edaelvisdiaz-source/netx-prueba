import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Hasta donde ha leido Radika cada carpeta de cada buzon. */
@Entity('buzones')
export class Buzon {
  @PrimaryColumn({ type: 'text' }) direccion!: string;
  @PrimaryColumn({ type: 'text' }) carpeta!: string;
  @Column({ name: 'uid_validity', type: 'text' }) uidValidity!: string;
  @Column({ name: 'ultimo_uid', type: 'int' }) ultimoUid!: number;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** Correo de un despacho que no se pudo enlazar con ningun tramite; alguien debe revisarlo. */
@Entity('correos_pendientes')
@Index('uq_correos_pendientes_mensaje', ['buzon', 'messageId'], { unique: true })
export class CorreoPendiente {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'text' }) buzon!: string;
  @Column({ name: 'message_id', type: 'text' }) messageId!: string;
  @Column({ type: 'text' }) remitente!: string;
  @Column({ name: 'remitente_nombre', type: 'text', nullable: true }) remitenteNombre!: string | null;
  @Column({ type: 'text' }) asunto!: string;
  @Column({ type: 'timestamptz' }) fecha!: Date;
  @Column({ type: 'text' }) motivo!: string;
  @Column({ type: 'text', nullable: true }) carpeta!: string | null;
  /** Radicado completo que Radika encontro en el correo, cuando el tramite aun no esta registrado. */
  @Column({ name: 'radicado_sugerido', type: 'text', nullable: true }) radicadoSugerido!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
