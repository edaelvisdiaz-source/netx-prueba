import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { EstadoTramite, FuenteId, TipoTramite } from './tipos';

@Entity('tramites')
@Index('uq_tramites_fuente_radicado', ['fuente', 'radicado'], { unique: true })
export class Tramite {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'text' }) tipo!: TipoTramite;
  @Column({ type: 'text' }) fuente!: FuenteId;
  @Column({ type: 'text' }) radicado!: string;
  /** Codigo de la venta en el CRM (por ejemplo E4MXO9T4) para enlazar el aviso con su tarjeta. */
  @Column({ name: 'referencia_crm', type: 'text', nullable: true }) referenciaCrm!: string | null;
  @Column({ name: 'cliente_nombre', type: 'text', nullable: true }) clienteNombre!: string | null;
  @Column({ type: 'text', default: 'ACTIVO' }) estado!: EstadoTramite;
  @Column({ type: 'text', nullable: true }) despacho!: string | null;
  @Column({ type: 'text', nullable: true }) sujetos!: string | null;
  @Column({ name: 'fecha_radicacion', type: 'date', nullable: true }) fechaRadicacion!: string | null;
  @Column({ name: 'ultima_actuacion_fecha', type: 'date', nullable: true }) ultimaActuacionFecha!: string | null;
  /** Estado tal como lo muestra el portal de la entidad (tramites con inicio de sesion). */
  @Column({ name: 'estado_fuente', type: 'text', nullable: true }) estadoFuente!: string | null;
  @Column({ name: 'estado_fuente_desde', type: 'timestamptz', nullable: true }) estadoFuenteDesde!: Date | null;
  /** El portal rechazo la clave: no se vuelve a intentar hasta que se registre una nueva. */
  @Column({ name: 'credencial_rechazada', type: 'boolean', default: false }) credencialRechazada!: boolean;
  @Column({ name: 'ultima_revision_at', type: 'timestamptz', nullable: true }) ultimaRevisionAt!: Date | null;
  @Column({ name: 'sincronizado_at', type: 'timestamptz', nullable: true }) sincronizadoAt!: Date | null;
  @Column({ name: 'proxima_revision_at', type: 'timestamptz' }) proximaRevisionAt!: Date;
  @Column({ name: 'ultimo_error', type: 'text', nullable: true }) ultimoError!: string | null;
  @Column({ name: 'errores_consecutivos', type: 'int', default: 0 }) erroresConsecutivos!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
