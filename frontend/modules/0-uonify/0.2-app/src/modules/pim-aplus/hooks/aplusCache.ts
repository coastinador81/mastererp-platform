import type { PimScope } from '@/shared/pim';
import { DEBOUNCE_DELAY } from '../model/constants';
import { asSlice, cacheKeyOf, copySlice, readCachedData, snapshotData, type MutableSlice } from '../model/cache';
import type { AplusCacheData, AplusDocument } from '../model/types';

/**
 * Caché de la pestaña sobre la porción `aplus` del producto (useAplusCache del
 * original: 30 min y escritura diferida de 1 s). E12/A04: guarda cada edición y, al
 * salir de la pestaña, vuelca lo pendiente. Un producto sin ASIN guarda sus módulos
 * en 'local' sin caducidad: son su única copia.
 */
export class AplusCache {
  readonly key: string;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly scope: PimScope,
    private readonly asin: string | undefined,
    private readonly current: () => AplusCacheData,
    private readonly alive: () => boolean,
  ) {
    this.key = cacheKeyOf(asin);
  }

  private write(mutator: (slice: MutableSlice) => MutableSlice): void {
    this.scope.update<unknown>('aplus', previous => mutator(copySlice(previous)), {});
  }

  storedCrk(): string | null {
    if (!this.asin) return null;
    return asSlice(this.scope.get('aplus', null)).crk?.[this.asin] || null;
  }

  setStoredCrk(crk: string): void {
    const asin = this.asin;
    if (!asin) return;
    this.write(slice => {
      slice.crk[asin] = crk;
      return slice;
    });
  }

  /** Datos guardados, o null si no hay (o han caducado: entonces se borran). */
  load(now = Date.now()): AplusCacheData | null {
    const { data, expired } = readCachedData(asSlice(this.scope.get('aplus', null)), this.key, Boolean(this.asin), now);
    if (expired) {
      const asin = this.asin as string;
      this.write(slice => {
        delete slice.content[asin];
        return slice;
      });
    }
    return data;
  }

  /** Sin contenido de Amazon: se borran el contenido y la clave del ASIN. */
  clear(): void {
    const asin = this.asin;
    if (!asin) return;
    this.cancel();
    this.write(slice => {
      delete slice.content[asin];
      delete slice.crk[asin];
      return slice;
    });
  }

  /** Tras un guardado correcto: se borra el contenido (la clave se conserva). */
  removeContent(): void {
    const asin = this.asin;
    if (!asin) return;
    this.cancel();
    this.write(slice => {
      delete slice.content[asin];
      return slice;
    });
  }

  /**
   * Guardado que termina con la pestaña cerrada y ediciones durante la petición:
   * la entrada se conserva con esas ediciones y apunta al documento guardado.
   */
  pointTo(crk: string, newDocument: AplusDocument | null): void {
    const asin = this.asin;
    if (!asin) return;
    this.write(slice => {
      const entry = slice.content[asin];
      if (entry?.data) {
        const data = { ...entry.data, selectedDocumentKey: crk };
        if (newDocument) data.availableDocuments = [newDocument];
        slice.content[asin] = { ...entry, data };
      }
      return slice;
    });
  }

  saveNow(): void {
    this.timer = null;
    const data = snapshotData(this.current());
    const key = this.key;
    this.write(slice => {
      slice.content[key] = { data, timestamp: Date.now() };
      return slice;
    });
  }

  schedule(): void {
    if (!this.alive()) return;
    this.cancel();
    this.timer = setTimeout(() => this.saveNow(), DEBOUNCE_DELAY);
  }

  /** Al salir de la pestaña: escribe ya lo pendiente. */
  flush(): void {
    if (!this.timer) return;
    this.cancel();
    this.saveNow();
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
