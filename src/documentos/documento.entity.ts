import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const ORIGENES_DOCUMENTO = ['CORREO', 'MANUAL'] as const;
export type OrigenDocumento = (typeof ORIGENES_DOCUMENTO)[number];

/** Archivo de un tramite (auto, fallo, acta...). El contenido vive en el almacen; aqui solo su ficha. */
@Entity('documentos')
@Index('uq_documentos_tramite_huella', ['tramiteId', 'sha256'], { unique: true })
export class Documento {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tramite_id', type: 'uuid' }) tramiteId!: string;
  /** Actuacion con la que llego (por ejemplo, el correo del juzgado), si se conoce. */
  @Column({ name: 'actuacion_id', type: 'uuid', nullable: true }) actuacionId!: string | null;
  @Column({ type: 'text' }) origen!: OrigenDocumento;
  @Column({ type: 'text' }) nombre!: string;
  @Column({ type: 'text' }) tipo!: string;
  @Column({ type: 'int' }) bytes!: number;
  @Column({ type: 'text' }) sha256!: string;
  /** Ubicacion dentro del almacen. No se expone. */
  @Column({ type: 'text', select: false }) clave!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
