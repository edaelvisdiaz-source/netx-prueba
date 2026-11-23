export interface CorreoLeido {
  readonly uid: number;
  readonly messageId: string;
  readonly from: string;
  readonly fromNombre: string | null;
  readonly subject: string;
  readonly date: string;
  readonly adjuntos: ReadonlyArray<string>;
}

/** Hasta donde se leyo una carpeta la ultima vez. */
export interface PuntoDeLectura {
  readonly uidValidity: string;
  readonly ultimoUid: number;
}

export interface LecturaCarpeta {
  readonly carpeta: string;
  /** Cambia si el servidor reorganiza la carpeta; entonces los UID anteriores dejan de valer. */
  readonly uidValidity: string;
  /** UID mas alto que existe hoy en la carpeta. */
  readonly uidMaximo: number;
  /** Vacio si la carpeta es nueva para Radika o fue renumerada: primero se fija el punto de partida. */
  readonly correos: ReadonlyArray<CorreoLeido>;
  /** En una carpeta nueva: desde que UID empezar si se pidio procesar historial (si falta, desde `uidMaximo`). */
  readonly inicio?: number;
}

export interface AdjuntoDescargado {
  readonly nombre: string;
  readonly contenido: Buffer;
}

/** Acceso de solo lectura al buzon donde llegan las notificaciones. Nunca mueve, marca ni borra. */
export abstract class LectorBuzon {
  /** Direccion del buzon, o `null` si no esta configurado. */
  abstract readonly buzon: string | null;
  /**
   * Recorre las carpetas vigiladas y devuelve, de cada una, los encabezados de los correos
   * posteriores a su punto de lectura (hasta `maximo` por carpeta), en orden.
   */
  abstract leer(puntos: ReadonlyMap<string, PuntoDeLectura>, maximo: number): Promise<LecturaCarpeta[]>;
  /**
   * Texto del cuerpo y de los PDF adjuntos de un correo. Se usa solo para buscar el radicado
   * cuando el asunto no lo trae; quien lo pide no debe guardarlo.
   */
  abstract leerContenido(carpeta: string, uid: number): Promise<string>;
  /** Los PDF adjuntos de un correo (unos pocos, de tamano moderado), para guardarlos en el tramite. */
  abstract descargarAdjuntos(carpeta: string, uid: number): Promise<AdjuntoDescargado[]>;
}
