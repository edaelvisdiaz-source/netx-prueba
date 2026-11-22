import { Injectable, NotImplementedException } from '@nestjs/common';
import { FuenteId } from '../tramites/tipos';
import { Fuente } from './fuente';
import { RamaJudicialFuente } from './rama-judicial.fuente';

@Injectable()
export class FuentesRegistry {
  private readonly fuentes: ReadonlyMap<FuenteId, Fuente>;

  constructor(ramaJudicial: RamaJudicialFuente) {
    this.fuentes = new Map<FuenteId, Fuente>([[ramaJudicial.id, ramaJudicial]]);
  }

  obtener(id: FuenteId): Fuente {
    const fuente = this.fuentes.get(id);
    if (!fuente) throw new NotImplementedException(`La fuente ${id} no tiene consulta automatica`);
    return fuente;
  }
}
