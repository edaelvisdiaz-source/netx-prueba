import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { FuenteId } from '../tramites/tipos';
import { Fuente } from './fuente';
import { FuentePortal, PORTALES } from './fuente-portal';
import { RamaJudicialFuente } from './rama-judicial.fuente';

@Injectable()
export class FuentesRegistry {
  private readonly fuentes: ReadonlyMap<FuenteId, Fuente | FuentePortal>;

  constructor(ramaJudicial: RamaJudicialFuente, @Inject(PORTALES) portales: ReadonlyArray<FuentePortal>) {
    this.fuentes = new Map<FuenteId, Fuente | FuentePortal>([
      [ramaJudicial.id, ramaJudicial],
      ...portales.map((portal): [FuenteId, FuentePortal] => [portal.id, portal]),
    ]);
  }

  obtener(id: FuenteId): Fuente | FuentePortal {
    const fuente = this.fuentes.get(id);
    if (!fuente) throw new NotImplementedException(`La fuente ${id} no tiene consulta automatica`);
    return fuente;
  }

  /** Fuentes que esta instalacion puede consultar sola. */
  disponibles(): FuenteId[] {
    return [...this.fuentes.keys()];
  }
}
