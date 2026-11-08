import { NEW_PRODUCT_KEY, type PimEdited } from '@/shared/pim';
import type { CatalogProduct } from './types';

/**
 * Reglas del guardado de una ficha (prototipo: persistProduct de app-shell.js).
 * Las usan la ficha (ctx.persist) y la simulación del backend (POST/PATCH /products),
 * así el contrato es el mismo a los dos lados.
 */
export const MSG_REQUIRED = 'El nombre y el SKU son obligatorios.';
export const MSG_SKU_TAKEN = 'Este SKU ya pertenece a otro producto.';
export const MSG_NOT_FOUND = 'Este producto ya no está en tu catálogo.';

/** Nombre y SKU recortados; lanza Error(MSG_REQUIRED) si falta alguno. */
export function requiredFields(data: PimEdited): { name: string; sku: string } {
  const name = String(data.name ?? '').trim();
  const sku = String(data.sku ?? '').trim();
  if (!name || !sku) throw new Error(MSG_REQUIRED);
  return { name, sku };
}

/** Si el SKU ya es de otro producto (`ownSku` = el del producto que se guarda). */
export function isSkuTaken(products: CatalogProduct[], sku: unknown, ownSku: string | null): boolean {
  const wanted = String(sku ?? '').trim();
  return products.some(item => item.sku === wanted && item.sku !== ownSku);
}

export interface PersistTarget {
  /** SKU del producto que se actualiza, o null si se crea uno. */
  target: string | null;
  /** Clave del almacén del PIM que hay que mover al SKU guardado. */
  fromKey: string | null;
}

/**
 * Qué producto guarda una llamada a persist: `key` es el SKU con el que empezó el
 * guardado, así uno que termina después de abrir otro producto cae en el suyo.
 */
export function resolvePersistTarget({ create = false, key = null, currentSku = null }: {
  create?: boolean;
  key?: string | null;
  currentSku?: string | null;
}): PersistTarget {
  const target = create ? null : key && key !== NEW_PRODUCT_KEY ? key : currentSku;
  return { target, fromKey: create ? NEW_PRODUCT_KEY : target };
}

export interface SaveResult {
  products: CatalogProduct[];
  saved: CatalogProduct;
}

/**
 * Guarda en la lista: actualiza `target` en su sitio o, si no existe, crea el
 * producto al principio (source «uonify», status «draft»). Nada de lo escrito se
 * descarta. Lanza los mismos errores que el prototipo.
 */
export function saveInCatalog(
  products: CatalogProduct[],
  data: PimEdited,
  { target, now = Date.now() }: { target: string | null; now?: number },
): SaveResult {
  const { name, sku } = requiredFields(data);
  const index = target === null ? -1 : products.findIndex(item => item.sku === target);
  if (products.some((item, i) => item.sku === sku && i !== index)) throw new Error(MSG_SKU_TAKEN);
  const base: Partial<CatalogProduct> = index >= 0 ? products[index] : { source: 'uonify', status: 'draft', createdAt: now };
  const saved = { ...base, ...data, name, sku } as CatalogProduct;
  const next = index >= 0 ? products.map((item, i) => (i === index ? saved : item)) : [saved, ...products];
  return { products: next, saved };
}

/** Sustituye (o añade al principio) un producto guardado en la lista en caché. */
export function mergeSaved(products: CatalogProduct[], saved: CatalogProduct, previousSku: string | null): CatalogProduct[] {
  const index = previousSku === null ? -1 : products.findIndex(item => item.sku === previousSku);
  if (index < 0) return [saved, ...products.filter(item => item.sku !== saved.sku)];
  return products.map((item, i) => (i === index ? saved : item));
}

/** Copia profunda (el prototipo entrega copias JSON del producto). */
export function cloneProduct<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Búsqueda del catálogo: por nombre o SKU (como la ficha original). */
export function matchesSearch(product: CatalogProduct, term: string): boolean {
  const query = term.trim().toLowerCase();
  if (!query) return true;
  return String(product.name ?? '').toLowerCase().includes(query) || String(product.sku ?? '').toLowerCase().includes(query);
}

export type StatusFilter = 'all' | 'published' | 'draft' | 'processing';
export type SourceFilter = 'all' | 'uonify' | 'amazon' | 'shopify';

export interface CatalogFilters {
  search: string;
  status: StatusFilter;
  source: SourceFilter;
}

export const EMPTY_FILTERS: CatalogFilters = { search: '', status: 'all', source: 'all' };

/** Productos que cumplen la búsqueda y los filtros de estado y fuente. */
export function filterProducts(products: CatalogProduct[], filters: CatalogFilters): CatalogProduct[] {
  return products.filter(product => matchesSearch(product, filters.search)
    && (filters.status === 'all' || product.status === filters.status)
    && (filters.source === 'all' || product.source === filters.source));
}

export function hasActiveFilters(filters: CatalogFilters): boolean {
  return filters.status !== 'all' || filters.source !== 'all';
}
