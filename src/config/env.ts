import { z } from 'zod';

const LONGITUD_MINIMA_SECRETO = 32;
const booleano = z.enum(['true', 'false']).transform((valor) => valor === 'true');

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Cuantos proxies de confianza hay delante (0 si Radika recibe las peticiones directo). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    RADIKA_API_KEYS: z
      .string()
      .transform((valor) => valor.split(',').map((llave) => llave.trim()).filter(Boolean))
      .pipe(z.array(z.string().min(LONGITUD_MINIMA_SECRETO)).min(1)),
    CRM_WEBHOOK_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    CRM_WEBHOOK_SECRET: z
      .string()
      .min(LONGITUD_MINIMA_SECRETO)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    RAMA_BASE_URL: z.string().url().default('https://consultaprocesos.ramajudicial.gov.co:448/api/v2'),
    RAMA_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(1500),
    RAMA_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20000),
    REVISION_INTERVALO_HORAS: z.coerce.number().min(0.25).max(168).default(4),
    REVISION_LOTE: z.coerce.number().int().min(1).max(100).default(10),
    SCHEDULER_ENABLED: booleano.default('true'),
    CONTACTO_USER_AGENT: z.string().min(3).default('Radika/0.1'),
    /** Opcional. Sin llave, Radika funciona igual pero no redacta resumenes. */
    ANTHROPIC_API_KEY: z.string().min(20).optional().or(z.literal('').transform(() => undefined)),
    RESUMEN_IA_MODELO: z.string().min(3).default('claude-opus-5-5'),
    /** Dominios desde los que se aceptan correos de despachos (incluye sus subdominios). */
    CORREO_DOMINIOS_CONFIABLES: z
      .string()
      .default('ramajudicial.gov.co,consejodeestado.gov.co,corteconstitucional.gov.co')
      .transform((valor) => valor.split(',').map((dominio) => dominio.trim().toLowerCase()).filter(Boolean)),
    /** Buzon donde llegan las notificaciones. Sin estos tres datos el lector queda apagado. */
    IMAP_HOST: z.string().min(3).optional().or(z.literal('').transform(() => undefined)),
    IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
    IMAP_USER: z.string().email().optional().or(z.literal('').transform(() => undefined)),
    IMAP_PASSWORD: z.string().min(1).optional().or(z.literal('').transform(() => undefined)),
    IMAP_CARPETA: z.string().min(1).default('INBOX'),
    RESUMENES_POR_REVISION: z.coerce.number().int().min(0).max(50).default(10),
  })
  .superRefine((env, contexto) => {
    if (env.CRM_WEBHOOK_URL && !env.CRM_WEBHOOK_SECRET) {
      contexto.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CRM_WEBHOOK_SECRET'],
        message: 'es obligatorio cuando se define CRM_WEBHOOK_URL',
      });
    }
    if (env.NODE_ENV === 'production' && env.CRM_WEBHOOK_URL && !env.CRM_WEBHOOK_URL.startsWith('https://')) {
      contexto.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CRM_WEBHOOK_URL'],
        message: 'debe usar https en produccion',
      });
    }
  });

export type Env = z.infer<typeof esquema>;
export const ENV = Symbol('ENV');

/** Valida la configuracion al arrancar. El mensaje nombra la variable, nunca su valor. */
export function cargarEnv(origen: NodeJS.ProcessEnv = process.env): Env {
  const resultado = esquema.safeParse(origen);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((problema) => `${problema.path.join('.') || 'env'}: ${problema.message}`)
      .join('; ');
    throw new Error(`Configuracion invalida. ${detalle}`);
  }
  return resultado.data;
}
