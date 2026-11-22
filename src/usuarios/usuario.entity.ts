import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const ROLES = ['ADMIN', 'ASESOR'] as const;
export type Rol = (typeof ROLES)[number];

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'text', unique: true }) email!: string;
  @Column({ type: 'text' }) nombre!: string;
  @Column({ type: 'text' }) rol!: Rol;
  @Column({ name: 'huella_clave', type: 'text', select: false }) huellaClave!: string;
  /** La clave la puso un administrador: hay que cambiarla al entrar. */
  @Column({ name: 'debe_cambiar_clave', type: 'boolean', default: true }) debeCambiarClave!: boolean;
  @Column({ type: 'boolean', default: true }) activo!: boolean;
  @Column({ name: 'intentos_fallidos', type: 'int', default: 0, select: false }) intentosFallidos!: number;
  @Column({ name: 'bloqueado_hasta', type: 'timestamptz', nullable: true, select: false }) bloqueadoHasta!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity('sesiones')
export class Sesion {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index({ unique: true })
  @Column({ name: 'huella_token', type: 'text' }) huellaToken!: string;
  @Column({ name: 'usuario_id', type: 'uuid' }) usuarioId!: string;
  @Column({ name: 'expira_at', type: 'timestamptz' }) expiraAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
