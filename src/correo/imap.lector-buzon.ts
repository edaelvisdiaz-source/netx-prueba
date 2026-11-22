import { Inject, Injectable } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { ENV, Env } from '../config/env';
import { CorreoLeido, LectorBuzon, LecturaBuzon } from './lector-buzon';

interface NodoEstructura {
  readonly disposition?: string;
  readonly dispositionParameters?: Record<string, string>;
  readonly parameters?: Record<string, string>;
  readonly childNodes?: ReadonlyArray<NodoEstructura>;
}

/** Nombres de los archivos adjuntos (no las imagenes incrustadas en la firma). */
export function nombresDeAdjuntos(nodo: NodoEstructura | undefined): string[] {
  if (!nodo) return [];
  const propio =
    nodo.disposition?.toLowerCase() === 'attachment'
      ? [nodo.dispositionParameters?.filename ?? nodo.parameters?.name].filter((nombre): nombre is string => Boolean(nombre))
      : [];
  return [...propio, ...(nodo.childNodes ?? []).flatMap(nombresDeAdjuntos)];
}

/** Lee el buzon por IMAP con la carpeta abierta en modo solo lectura. */
@Injectable()
export class ImapLectorBuzon extends LectorBuzon {
  readonly buzon: string | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
    this.buzon = env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASSWORD ? env.IMAP_USER : null;
  }

  /* istanbul ignore next -- habla con un servidor de correo real; se prueba con el buzon de verdad */
  async leerDesde(ultimoUid: number, maximo: number): Promise<LecturaBuzon> {
    const { IMAP_HOST: host, IMAP_USER: user, IMAP_PASSWORD: pass } = this.env;
    if (!host || !user || !pass) throw new Error('El buzon no esta configurado');
    const cliente = new ImapFlow({ host, port: this.env.IMAP_PORT, secure: true, auth: { user, pass }, logger: false });
    await cliente.connect();
    try {
      const candado = await cliente.getMailboxLock(this.env.IMAP_CARPETA, { readOnly: true });
      try {
        const carpeta = cliente.mailbox;
        if (!carpeta) throw new Error('No se pudo abrir la carpeta del buzon');
        const uidMaximo = carpeta.uidNext - 1;
        const correos: CorreoLeido[] = [];
        if (uidMaximo > ultimoUid) {
          const rango = `${ultimoUid + 1}:${Math.min(uidMaximo, ultimoUid + maximo)}`;
          for await (const mensaje of cliente.fetch(rango, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
            const remitente = mensaje.envelope?.from?.[0];
            if (!remitente?.address || !mensaje.envelope?.messageId) continue;
            correos.push({
              uid: mensaje.uid,
              messageId: mensaje.envelope.messageId.trim(),
              from: remitente.address,
              fromNombre: remitente.name || null,
              subject: mensaje.envelope.subject ?? '',
              date: new Date(mensaje.envelope.date ?? Date.now()).toISOString(),
              adjuntos: nombresDeAdjuntos(mensaje.bodyStructure as NodoEstructura | undefined),
            });
          }
        }
        return { uidValidity: String(carpeta.uidValidity), uidMaximo, correos: correos.sort((a, b) => a.uid - b.uid) };
      } finally {
        candado.release();
      }
    } finally {
      await cliente.logout().catch(() => undefined);
    }
  }
}
