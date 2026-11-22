import { z } from 'zod';
import { ESTADOS_TRAMITE, FUENTES, TIPOS_TRAMITE } from './tipos';

const LIMITE_MAXIMO = 100;
const referenciaCrm = z.string().trim().min(1).max(64).regex(/^[\w\-.]+$/, 'solo letras, numeros, guion y punto');
const clienteNombre = z.string().trim().min(1).max(160);

export const crearTramiteSchema = z
  .object({
    tipo: z.enum(TIPOS_TRAMITE),
    radicado: z.string().min(1).max(80),
    fuente: z.enum(FUENTES).optional(),
    referenciaCrm: referenciaCrm.optional(),
    clienteNombre: clienteNombre.optional(),
  })
  .strict();
export type CrearTramite = z.infer<typeof crearTramiteSchema>;

export const listarTramitesSchema = z
  .object({
    referenciaCrm: referenciaCrm.optional(),
    tipo: z.enum(TIPOS_TRAMITE).optional(),
    estado: z.enum(ESTADOS_TRAMITE).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(20),
  })
  .strict();
export type ListarTramites = z.infer<typeof listarTramitesSchema>;

export const actualizarTramiteSchema = z
  .object({
    estado: z.enum(ESTADOS_TRAMITE).optional(),
    referenciaCrm: referenciaCrm.nullable().optional(),
    clienteNombre: clienteNombre.nullable().optional(),
  })
  .strict()
  .refine((cambios) => Object.keys(cambios).length > 0, { message: 'envia al menos un campo' });
export type ActualizarTramite = z.infer<typeof actualizarTramiteSchema>;

export const listarEventosSchema = z
  .object({
    cursor: z.string().max(80).regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z_[0-9a-f-]{36}$/).optional(),
    limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(50),
  })
  .strict();
export type ListarEventos = z.infer<typeof listarEventosSchema>;
