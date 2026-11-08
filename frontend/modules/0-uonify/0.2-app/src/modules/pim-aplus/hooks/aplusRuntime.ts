import type { AplusCache } from './aplusCache';
import type { ImageDownloads } from './aplusImages';
import type { AplusStore } from './aplusStore';

/**
 * Lo que comparten las operaciones asíncronas de la pestaña (cargar, guardar,
 * restaurar imágenes). Lo implementa AplusController.
 */
export interface AplusRuntime {
  readonly store: AplusStore;
  readonly asin: string | undefined;
  readonly cache: AplusCache;
  readonly images: ImageDownloads;
  /**
   * Marca del montaje actual. Una operación la toma al empezar y, al terminar,
   * solo toca la pantalla si `live(token)` (la pestaña sigue montada: el
   * `destroyed` del original).
   */
  token(): number;
  live(token: number): boolean;
  /** Contador de ediciones (para saber si se editó durante un guardado). */
  editVersion(): number;
  /** Marca del producto abierto (respaldo de la marca del documento). */
  productBrand(): string | undefined;
}
