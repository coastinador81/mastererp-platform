import { CACHE_TTL } from './constants';
import type { AplusCacheData, AplusCacheEntry, AplusImage, AplusModule, AplusSlice } from './types';

/**
 * Caché de la pestaña en la porción `aplus` del almacén por producto
 * (hooks/useAplusCache.ts y utils/multiTenantStorage.ts del original). Funciones
 * puras: quien las usa lee y escribe la porción.
 */
export interface MutableSlice {
  content: Record<string, AplusCacheEntry>;
  crk: Record<string, string>;
}

/** Clave de la caché: el ASIN, o 'local' para un producto creado en Uonify. */
export const cacheKeyOf = (asin: string | undefined): string => asin || 'local';

export function asSlice(value: unknown): AplusSlice {
  return value && typeof value === 'object' ? (value as AplusSlice) : {};
}

/** Copia editable de la porción (content y crk nuevos). */
export function copySlice(value: unknown): MutableSlice {
  const current = asSlice(value);
  return { ...current, content: { ...(current.content || {}) }, crk: { ...(current.crk || {}) } };
}

/**
 * Las imágenes descargadas (data:) que se pueden volver a pedir por image-proxy no
 * se guardan, como en el original; el resto se guarda tal cual (sin el File).
 */
export function cacheImage(image: AplusImage | null | undefined): AplusImage | null {
  if (!image) return null;
  const id = image.uploadDestinationId;
  const restorable = Boolean(id) && !String(id).includes('dummy');
  const url = typeof image.url === 'string' && image.url.startsWith('data:') && restorable ? null : image.url;
  return { ...image, file: null, url };
}

function cacheModule(module: AplusModule): AplusModule {
  const content: Record<string, unknown> = { ...module.content };
  if ('backgroundImage' in content) content.backgroundImage = cacheImage(content.backgroundImage as AplusImage | null);
  if ('image' in content) content.image = cacheImage(content.image as AplusImage | null);
  if (Array.isArray(content.sections)) {
    content.sections = (content.sections as { image?: AplusImage | null }[]).map(section => ({ ...section, image: cacheImage(section.image) }));
  }
  return { ...module, content } as unknown as AplusModule;
}

/** Lo que se guarda: copia JSON del estado con las imágenes preparadas. */
export function snapshotData(data: AplusCacheData): AplusCacheData {
  return JSON.parse(JSON.stringify({
    modules: data.modules.map(cacheModule),
    brand: data.brand,
    hasUnsavedChanges: data.hasUnsavedChanges,
    availableDocuments: data.availableDocuments,
    selectedDocumentKey: data.selectedDocumentKey,
  })) as AplusCacheData;
}

/**
 * Entrada de la caché. El contenido de Amazon (con ASIN) caduca a los 30 min
 * (`expired` = hay que borrarla); el de un producto sin ASIN no caduca.
 */
export function readCachedData(slice: AplusSlice, key: string, hasAsin: boolean, now = Date.now()): { data: AplusCacheData | null; expired: boolean } {
  const entry = slice.content?.[key];
  if (!entry || !entry.data) return { data: null, expired: false };
  if (hasAsin && now - (entry.timestamp || 0) > CACHE_TTL) return { data: null, expired: true };
  return { data: JSON.parse(JSON.stringify(entry.data)) as AplusCacheData, expired: false };
}
