import { Inject, Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { ENV, Env } from '../config/env';
import { AdjuntoDescargado, CorreoLeido, LectorBuzon, LecturaCarpeta, PuntoDeLectura } from './lector-buzon';
import { textoDePdf } from './texto-pdf';

export interface NodoEstructura {
  readonly part?: string;
  readonly type?: string;
  readonly size?: number;
  readonly disposition?: string;
  readonly dispositionParameters?: Record<string, string>;
  readonly parameters?: Record<string, string>;
  readonly childNodes?: ReadonlyArray<NodoEstructura>;
}

export interface CarpetaImap {
  readonly path: string;
  readonly specialUse?: string;
  readonly flags?: ReadonlySet<string>;
}

interface ParteUtil {
  readonly part: string;
  readonly nombre: string;
}

const USOS_EXCLUIDOS: ReadonlySet<string> = new Set(['\\Sent', '\\Drafts', '\\Trash', '\\Junk', '\\All']);
/** Por si el servidor no marca el uso especial de la carpeta. */
const NOMBRES_EXCLUIDOS = /^(sent|sent items|enviados|drafts|borradores|trash|papelera|deleted items|junk|spam|correo no deseado)$/i;
const PDF_MAXIMOS = 2;
const PDF_BYTES_MAXIMOS = 3 * 1024 * 1024;
const CUERPO_BYTES_MAXIMOS = 200 * 1024;
const TEXTO_MAXIMO = 50_000;
const ADJUNTOS_MAXIMOS = 6;
const ADJUNTO_BYTES_MAXIMOS = 15 * 1024 * 1024;
const MS_DIA = 86_400_000;
const NOMBRE_DE_ACTA = /acta|reparto|caratula|radica/i;

function nombreDe(nodo: NodoEstructura): string | undefined {
  return nodo.dispositionParameters?.filename ?? nodo.parameters?.name;
}

function hojas(nodo: NodoEstructura | undefined): NodoEstructura[] {
  if (!nodo) return [];
  return nodo.childNodes?.length ? nodo.childNodes.flatMap(hojas) : [nodo];
}

function esAdjunto(nodo: NodoEstructura): boolean {
  return nodo.disposition?.toLowerCase() === 'attachment';
}

/** Nombres de los archivos adjuntos (no las imagenes incrustadas en la firma). */
export function nombresDeAdjuntos(nodo: NodoEstructura | undefined): string[] {
  return hojas(nodo).filter(esAdjunto).map(nombreDe).filter((nombre): nombre is string => Boolean(nombre));
}

/** Un encabezado de fecha ilegible no debe impedir leer el buzon: se toma la hora actual. */
export function fechaSegura(valor: Date | string | undefined | null): string {
  const fecha = new Date(valor ?? Date.now());
  return (Number.isNaN(fecha.getTime()) ? new Date() : fecha).toISOString();
}

/** Carpetas donde pueden llegar o archivarse notificaciones: todas menos enviados, borradores, papelera y spam. */
export function carpetasVigiladas(todas: ReadonlyArray<CarpetaImap>, configuradas: ReadonlyArray<string> | undefined): string[] {
  const legibles = todas.filter((carpeta) => !carpeta.flags?.has('\\Noselect'));
  if (configuradas) return legibles.map((carpeta) => carpeta.path).filter((ruta) => configuradas.includes(ruta));
  return legibles
    .filter((carpeta) => !USOS_EXCLUIDOS.has(carpeta.specialUse ?? ''))
    .filter((carpeta) => !NOMBRES_EXCLUIDOS.test(carpeta.path.split(/[./]/).at(-1) ?? ''))
    .map((carpeta) => carpeta.path);
}

/** Partes de un correo donde puede estar el radicado: el cuerpo en texto y unos pocos PDF pequenos. */
export function partesConRadicado(estructura: NodoEstructura | undefined): { cuerpo: string | null; pdfs: ParteUtil[] } {
  const todas = hojas(estructura).map((nodo) => ({ ...nodo, part: nodo.part ?? '1' }));
  const cuerpos = todas.filter((nodo) => !esAdjunto(nodo) && (nodo.size ?? 0) <= CUERPO_BYTES_MAXIMOS);
  const cuerpo = cuerpos.find((nodo) => nodo.type === 'text/plain') ?? cuerpos.find((nodo) => nodo.type === 'text/html');
  const pdfs = todas
    .filter((nodo) => nodo.type === 'application/pdf' || /\.pdf$/i.test(nombreDe(nodo) ?? ''))
    .filter((nodo) => (nodo.size ?? Number.MAX_SAFE_INTEGER) <= PDF_BYTES_MAXIMOS)
    .map((nodo) => ({ part: nodo.part, nombre: nombreDe(nodo) ?? '' }))
    // Primero los que por nombre parecen el acta de reparto.
    .sort((a, b) => Number(NOMBRE_DE_ACTA.test(b.nombre)) - Number(NOMBRE_DE_ACTA.test(a.nombre)))
    .slice(0, PDF_MAXIMOS);
  return { cuerpo: cuerpo?.part ?? null, pdfs };
}

/** Los PDF adjuntos que vale la pena guardar: pocos y de tamano moderado. */
export function pdfAdjuntos(estructura: NodoEstructura | undefined): ParteUtil[] {
  return hojas(estructura)
    .filter((nodo) => esAdjunto(nodo) && (nodo.type === 'application/pdf' || /\.pdf$/i.test(nombreDe(nodo) ?? '')))
    .filter((nodo) => (nodo.size ?? Number.MAX_SAFE_INTEGER) <= ADJUNTO_BYTES_MAXIMOS * 1.4) // el tamano declarado incluye la codificacion base64
    .map((nodo) => ({ part: nodo.part ?? '1', nombre: nombreDe(nodo) ?? 'adjunto.pdf' }))
    .slice(0, ADJUNTOS_MAXIMOS);
}

/**
 * Quita las etiquetas de un cuerpo HTML; solo interesa el texto para buscar numeros. Recorre el
 * texto una sola vez: un correo armado con miles de "<" sin cerrar no puede frenar el servicio.
 */
export function textoPlano(original: string): string {
  const contenido = original.slice(0, TEXTO_MAXIMO);
  const trozos: string[] = [];
  let desde = 0;
  while (desde < contenido.length) {
    const abre = contenido.indexOf('<', desde);
    if (abre === -1) {
      trozos.push(contenido.slice(desde));
      break;
    }
    trozos.push(contenido.slice(desde, abre));
    const cierra = contenido.indexOf('>', abre);
    if (cierra === -1) break;
    desde = cierra + 1;
  }
  return trozos.join(' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/* istanbul ignore next -- lee de una conexion real */
async function descargar(cliente: ImapFlow, uid: number, part: string, maximo: number): Promise<Buffer> {
  const { content } = await cliente.download(String(uid), part, { uid: true, maxBytes: maximo });
  if (!content) return Buffer.alloc(0);
  const trozos: Buffer[] = [];
  for await (const trozo of content) trozos.push(trozo as Buffer);
  return Buffer.concat(trozos);
}

/** Lee el buzon por IMAP con cada carpeta abierta en modo solo lectura. */
@Injectable()
export class ImapLectorBuzon extends LectorBuzon {
  readonly buzon: string | null;
  private readonly logger = new Logger(ImapLectorBuzon.name);

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
    this.buzon = env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASSWORD ? env.IMAP_USER : null;
  }

  /* istanbul ignore next -- habla con un servidor de correo real; se prueba con el buzon de verdad */
  private async conectado<T>(tarea: (cliente: ImapFlow) => Promise<T>): Promise<T> {
    const { IMAP_HOST: host, IMAP_USER: user, IMAP_PASSWORD: pass } = this.env;
    if (!host || !user || !pass) throw new Error('El buzon no esta configurado');
    const cliente = new ImapFlow({ host, port: this.env.IMAP_PORT, secure: true, auth: { user, pass }, logger: false });
    await cliente.connect();
    try {
      return await tarea(cliente);
    } finally {
      await cliente.logout().catch(() => undefined);
    }
  }

  /* istanbul ignore next */
  private async enCarpeta<T>(cliente: ImapFlow, carpeta: string, tarea: () => Promise<T>): Promise<T> {
    const candado = await cliente.getMailboxLock(carpeta, { readOnly: true });
    try {
      return await tarea();
    } finally {
      candado.release();
    }
  }

  /* istanbul ignore next */
  leer(puntos: ReadonlyMap<string, PuntoDeLectura>, maximo: number): Promise<LecturaCarpeta[]> {
    return this.conectado(async (cliente) => {
      const carpetas = carpetasVigiladas(await cliente.list(), this.env.IMAP_CARPETAS);
      const lecturas: LecturaCarpeta[] = [];
      for (const carpeta of carpetas) {
        // Una carpeta que no abre no debe impedir leer las demas.
        try {
          lecturas.push(await this.enCarpeta(cliente, carpeta, () => this.leerCarpeta(cliente, carpeta, puntos.get(carpeta), maximo)));
        } catch (error) {
          this.logger.warn(`No se pudo leer la carpeta ${carpeta}: ${error instanceof Error ? error.message : 'error'}`);
        }
      }
      return lecturas;
    });
  }

  /* istanbul ignore next */
  private async leerCarpeta(cliente: ImapFlow, carpeta: string, punto: PuntoDeLectura | undefined, maximo: number): Promise<LecturaCarpeta> {
    const abierta = cliente.mailbox;
    if (!abierta) throw new Error(`No se pudo abrir la carpeta ${carpeta}`);
    const uidValidity = String(abierta.uidValidity);
    const uidMaximo = abierta.uidNext - 1;
    const correos: CorreoLeido[] = [];
    if (punto && punto.uidValidity === uidValidity && uidMaximo > punto.ultimoUid) {
      const rango = `${punto.ultimoUid + 1}:${Math.min(uidMaximo, punto.ultimoUid + maximo)}`;
      for await (const mensaje of cliente.fetch(rango, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
        const remitente = mensaje.envelope?.from?.[0];
        if (!remitente?.address || !mensaje.envelope?.messageId) continue;
        correos.push({
          uid: mensaje.uid,
          messageId: mensaje.envelope.messageId.trim(),
          from: remitente.address,
          fromNombre: remitente.name || null,
          subject: mensaje.envelope.subject ?? '',
          date: fechaSegura(mensaje.envelope.date),
          adjuntos: nombresDeAdjuntos(mensaje.bodyStructure as NodoEstructura | undefined),
        });
      }
    }
    return { carpeta, uidValidity, uidMaximo, correos: correos.sort((a, b) => a.uid - b.uid), ...(await this.inicioDeHistorial(cliente, punto, uidMaximo)) };
  }

  /** Carpeta que Radika ve por primera vez: si se pidio historial, empieza justo antes del primer correo de esos dias. */
  /* istanbul ignore next */
  private async inicioDeHistorial(cliente: ImapFlow, punto: PuntoDeLectura | undefined, uidMaximo: number): Promise<{ inicio?: number }> {
    if (punto || this.env.IMAP_HISTORIAL_DIAS === 0) return {};
    const desde = new Date(Date.now() - this.env.IMAP_HISTORIAL_DIAS * MS_DIA);
    const uids = (await cliente.search({ since: desde }, { uid: true })) || [];
    return { inicio: uids.length ? Math.min(...uids) - 1 : uidMaximo };
  }

  /* istanbul ignore next */
  leerContenido(carpeta: string, uid: number): Promise<string> {
    return this.conectado((cliente) =>
      this.enCarpeta(cliente, carpeta, async () => {
        const mensaje = await cliente.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
        if (!mensaje) return '';
        const { cuerpo, pdfs } = partesConRadicado(mensaje.bodyStructure as NodoEstructura | undefined);
        const textos: string[] = [];
        if (cuerpo) textos.push(textoPlano((await descargar(cliente, uid, cuerpo, CUERPO_BYTES_MAXIMOS)).toString('utf8')));
        for (const pdf of pdfs) textos.push(await textoDePdf(await descargar(cliente, uid, pdf.part, PDF_BYTES_MAXIMOS)));
        return textos.join('\n');
      }),
    );
  }

  /* istanbul ignore next */
  descargarAdjuntos(carpeta: string, uid: number): Promise<AdjuntoDescargado[]> {
    return this.conectado((cliente) =>
      this.enCarpeta(cliente, carpeta, async () => {
        const mensaje = await cliente.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
        if (!mensaje) return [];
        const adjuntos: AdjuntoDescargado[] = [];
        for (const pdf of pdfAdjuntos(mensaje.bodyStructure as NodoEstructura | undefined)) {
          const contenido = await descargar(cliente, uid, pdf.part, ADJUNTO_BYTES_MAXIMOS);
          if (contenido.length > 0) adjuntos.push({ nombre: pdf.nombre, contenido });
        }
        return adjuntos;
      }),
    );
  }
}
