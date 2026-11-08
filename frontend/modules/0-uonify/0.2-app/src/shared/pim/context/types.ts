import type { PimScope } from '../store/pimStore';
import type { PimTabKey } from '../tabs';

/**
 * Contrato entre la ficha (módulo catalog) y cada pestaña (módulos pim-*).
 * Equivale al `ctx` que app-shell.js pasaba a `mount(el, ctx)` (pimContext()).
 */

/**
 * Producto guardado en el catálogo. Campos habituales del prototipo:
 * name, sku, brand, category, price, cost, stock, description, keywords,
 * bullets[], images[], image, customFields[], gpsr, source ('uonify'),
 * asin?, _raw_attributes?, status, sample?, createdAt.
 */
export interface PimProduct {
  sku: string;
  name: string;
  [field: string]: unknown;
}

/** Ediciones en curso (porción `edited`): name, sku, brand, category, price, cost, stock, description, keywords. */
export type PimEdited = Record<string, unknown>;

export interface PersistOptions {
  /** Crea el producto (exige nombre y SKU) y mueve el estado de '__new__' a su SKU. */
  create?: boolean;
  /** SKU con el que empezó el guardado: guarda en ese producto aunque ya haya otro abierto. */
  key?: string | null;
}

export interface PimTabContext {
  /** SKU del producto, o '__new__' si se está creando uno. */
  key: string;
  /** true en «Nuevo Producto». */
  isNew: boolean;
  /** Copia del producto guardado, o null. */
  product: PimProduct | null;
  /** pimStore.scope(key): porciones de este producto. */
  store: PimScope;
  /** Producto con las ediciones en curso: product + porción `edited`. */
  draft(): PimProduct | PimEdited;
  /** Mezcla `patch` en la porción `edited` (la cabecera muestra nombre y SKU en vivo). */
  edit(patch: PimEdited): void;
  /**
   * Guarda en el catálogo. Rechaza con Error('El nombre y el SKU son obligatorios.')
   * o Error('Este SKU ya pertenece a otro producto.'). Devuelve el producto guardado.
   */
  persist(data: PimEdited, options?: PersistOptions): Promise<PimProduct>;
  /** Si el SKU ya es de otro producto. */
  skuTaken(sku: string): boolean;
  /** Canales activos del producto en la cabecera: { Amazon: boolean }. */
  channels(): Record<string, boolean>;
  /** Cambia de pestaña (p. ej. la Auditoría lleva a Atributos). */
  switchTab(tab: PimTabKey): void;
  /** Vuelve a pintar la ficha (opcional). */
  rerender?(): void;
  /**
   * Búsqueda de categorías de Amazon:
   * GET /amazon/product-types/search?keywords=…&marketplace_id=…&country_code=ES.
   */
  categorySearch?(text: string): Promise<unknown>;
}
