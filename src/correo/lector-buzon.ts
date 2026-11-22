export interface CorreoLeido {
  readonly uid: number;
  readonly messageId: string;
  readonly from: string;
  readonly fromNombre: string | null;
  readonly subject: string;
  readonly date: string;
  readonly adjuntos: ReadonlyArray<string>;
}

export interface LecturaBuzon {
  /** Cambia si el servidor reorganiza el buzon; entonces los UID anteriores dejan de valer. */
  readonly uidValidity: string;
  /** UID mas alto que existe hoy en la carpeta. */
  readonly uidMaximo: number;
  readonly correos: ReadonlyArray<CorreoLeido>;
}

/** Acceso de solo lectura al buzon donde llegan las notificaciones. */
export abstract class LectorBuzon {
  /** Direccion del buzon, o `null` si no esta configurado. */
  abstract readonly buzon: string | null;
  /** Encabezados de los correos con UID mayor que `ultimoUid`, en orden. No lee el cuerpo ni marca nada. */
  abstract leerDesde(ultimoUid: number, maximo: number): Promise<LecturaBuzon>;
}
