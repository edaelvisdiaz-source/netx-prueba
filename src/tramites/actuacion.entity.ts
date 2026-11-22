import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ResumenActuacion } from '../resumen/resumidor';
import { CategoriaActuacion } from './tipos';

@Entity('actuaciones')
@Index('uq_actuaciones_tramite_clave', ['tramiteId', 'claveFuente'], { unique: true })
export class Actuacion {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tramite_id', type: 'uuid' }) tramiteId!: string;
  @Column({ name: 'clave_fuente', type: 'text' }) claveFuente!: string;
  @Column({ type: 'text', nullable: true }) despacho!: string | null;
  @Column({ type: 'date' }) fecha!: string;
  @Column({ type: 'text' }) titulo!: string;
  @Column({ type: 'text', nullable: true }) anotacion!: string | null;
  @Column({ name: 'fecha_inicio_termino', type: 'date', nullable: true }) fechaInicioTermino!: string | null;
  @Column({ name: 'fecha_fin_termino', type: 'date', nullable: true }) fechaFinTermino!: string | null;
  @Column({ name: 'fecha_registro', type: 'date', nullable: true }) fechaRegistro!: string | null;
  @Column({ type: 'text' }) categoria!: CategoriaActuacion;
  @Column({ type: 'jsonb', nullable: true }) resumen!: ResumenActuacion | null;
  @CreateDateColumn({ name: 'detectada_at', type: 'timestamptz' }) detectadaAt!: Date;
}
