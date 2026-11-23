import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const TIPOS_EVENTO = [
  'TRAMITE_SINCRONIZADO', 'ACTUACION_NUEVA', 'TERMINO_POR_VENCER', 'TERMINO_VENCIDO', 'ERROR_FUENTE', 'ETAPA_CAMBIADA',
] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];
export type EstadoEvento = 'PENDIENTE' | 'ENTREGADO' | 'FALLIDO';

/** Bandeja de salida: cada novedad se guarda aqui y luego se entrega al CRM. */
@Entity('eventos')
@Index('ix_eventos_pendientes', ['estado', 'proximoIntentoAt'])
export class Evento {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tramite_id', type: 'uuid' }) tramiteId!: string;
  @Column({ type: 'text' }) tipo!: TipoEvento;
  @Column({ type: 'jsonb' }) payload!: Record<string, unknown>;
  @Column({ type: 'text', default: 'PENDIENTE' }) estado!: EstadoEvento;
  @Column({ type: 'int', default: 0 }) intentos!: number;
  @Column({ name: 'proximo_intento_at', type: 'timestamptz' }) proximoIntentoAt!: Date;
  @Column({ name: 'entregado_at', type: 'timestamptz', nullable: true }) entregadoAt!: Date | null;
  /** Evita avisar dos veces lo mismo (por ejemplo, el mismo termino por vencer). */
  @Column({ name: 'clave_dedupe', type: 'text', nullable: true, unique: true }) claveDedupe!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
