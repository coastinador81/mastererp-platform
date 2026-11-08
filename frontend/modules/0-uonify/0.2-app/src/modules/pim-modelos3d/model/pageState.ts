/**
 * Estado de la página que la pestaña «3D» comparte entre montajes (prototipo:
 * pim/modelos3d.js, «estado de la página»). Vive en el módulo, no en React:
 * una generación sigue aunque se cierre el diálogo o se cambie de pestaña.
 */

/** blob: URLs creadas en esta carga de la página (modelos subidos y descargados). */
export const liveBlobURLs = new Set<string>();

/** Registra una blob: URL creada ahora (sigue viva hasta recargar). */
export function trackBlobURL(url: string): string {
  liveBlobURLs.add(url);
  return url;
}

/**
 * E29: las blob: URLs que la sesión ya guardaba al cargar la página son de una
 * carga anterior y ya no existen (el original perdía esas imágenes al recargar).
 */
export function scanStaleBlobURLs(storage: Pick<Storage, 'length' | 'key' | 'getItem'> | null): Set<string> {
  const found = new Set<string>();
  if (!storage) return found;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index);
      (storage.getItem(name ?? '') ?? '').match(/blob:[^"\\\s]+/g)?.forEach(url => found.add(url));
    }
  } catch {
    /* sin acceso a la sesión */
  }
  return found;
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export const staleBlobURLs: Set<string> = scanStaleBlobURLs(sessionStorageOrNull());

/** Si la blob: URL ya no existe (no se creó en esta carga de la página). */
export const isDeadBlob = (url: unknown): boolean =>
  typeof url === 'string' && url.startsWith('blob:') && !liveBlobURLs.has(url);

/** Generaciones en curso: clave de producto → { cancelled }. */
export interface GenerationRun {
  cancelled: boolean;
}
export const activeGenerations = new Map<string, GenerationRun>();

/** Empieza una generación para el producto (anula la anterior si la hubiera). */
export function startGenerationRun(productKey: string): GenerationRun {
  const previous = activeGenerations.get(productKey);
  if (previous) previous.cancelled = true;
  const run: GenerationRun = { cancelled: false };
  activeGenerations.set(productKey, run);
  return run;
}

export function endGenerationRun(productKey: string, run: GenerationRun): void {
  if (activeGenerations.get(productKey) === run) activeGenerations.delete(productKey);
}

/** «Cancelar»: la generación en curso del producto se detiene en el paso siguiente. */
export function cancelGenerationRun(productKey: string): void {
  const run = activeGenerations.get(productKey);
  if (run) run.cancelled = true;
}
