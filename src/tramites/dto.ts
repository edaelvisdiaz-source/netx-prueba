import { z } from 'zod';
import { soloFecha } from '../terminos/dias-habiles';
import { ESTADOS_TRAMITE, FUENTES, TIPOS_TRAMITE } from './tipos';

const LIMITE_MAXIMO = 100;
const PAGINA_MAXIMA = 10_000;
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
    page: z.coerce.number().int().min(1).max(PAGINA_MAXIMA).default(1),
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

export const registrarActuacionSchema = z
  .object({
    fecha: z.string().refine((valor) => soloFecha(valor) === valor, 'usa el formato AAAA-MM-DD'),
    titulo: z.string().trim().min(1).max(200),
    anotacion: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export type RegistrarActuacion = z.infer<typeof registrarActuacionSchema>;

const MAX_ADJUNTOS = 30;

export const correoEntranteSchema = z
  .object({
    messageId: z.string().trim().min(3).max(300),
    from: z.string().trim().email().max(320),
    fromNombre: z.string().trim().max(200).optional(),
    subject: z.string().max(500),
    date: z.string().datetime({ offset: true }),
    adjuntos: z.array(z.string().trim().min(1).max(200)).max(MAX_ADJUNTOS).optional(),
    /** Texto del correo. Solo se usa para buscar el radicado; no se guarda. */
    texto: z.string().max(50_000).optional(),
  })
  .strict();
export type CorreoEntrante = z.infer<typeof correoEntranteSchema>;

export const credencialSchema = z
  .object({ usuario: z.string().min(1).max(200), clave: z.string().min(1).max(200) })
  .strict();

export const listarEventosSchema = z
  .object({
    cursor: z
      .string()
      .max(80)
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
      .refine((valor) => !Number.isNaN(Date.parse(valor.split('_')[0])), 'fecha invalida')
      .optional(),
    limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(50),
  })
  .strict();
export type ListarEventos = z.infer<typeof listarEventosSchema>;
