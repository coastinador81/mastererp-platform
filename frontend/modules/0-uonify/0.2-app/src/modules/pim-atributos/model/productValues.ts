import { USE_MOCKS } from '@/shared/api/config';
import type { PimEdited, PimProduct } from '@/shared/pim';
import type { CategoryTerm, CustomField } from './types';

/**
 * Valores que enseña el formulario (prototipo: pim/atributos.js, newProduct()
 * y `current`; original: ProductsPIMInterface.tsx, editedProductData ??
 * selectedProductData) y los datos que se guardan al crear o guardar.
 */

type Value = string | number;
const text = (value: unknown): Value => (typeof value === 'number' ? value : value === undefined || value === null ? '' : String(value));

/** Borrador de «Nuevo Producto» (newProduct del original): la porción `edited` de '__new__'. */
export function newProductDraft(edited: PimEdited) {
  return {
    name: text(edited.name),
    sku: text(edited.sku),
    brand: text(edited.brand),
    category: text(edited.category),
    description: text(edited.description),
    price: text(edited.price),
    cost: text(edited.cost),
    stock: text(edited.stock),
  };
}
export type NewProductDraft = ReturnType<typeof newProductDraft>;

type CostPrice = { amount?: unknown } | undefined;

/** Valores del modo edición: lo editado, si existe; si no, lo guardado. */
export function currentValues(edited: PimEdited, product: PimProduct | null) {
  const p = (product ?? {}) as Record<string, unknown>;
  const costPrice = p.cost_price as CostPrice;
  const price = (): Value => {
    if (!USE_MOCKS) return text(edited.price ?? p.price ?? '');
    if (edited.price !== undefined) return text(edited.price);
    const fromProduct = p.retail_price || (p.source === 'amazon' ? (p.price !== costPrice?.amount ? p.price : '0.00') : p.price);
    return text(fromProduct || '0.00');
  };
  const cost = (): Value => {
    if (!USE_MOCKS) return text(edited.cost ?? p.cost ?? '');
    if (edited.cost !== undefined) return text(edited.cost);
    return text(costPrice?.amount || (p.source === 'amazon' ? '0.00' : p.cost || '0.00'));
  };
  return {
    name: text(edited.name ?? p.name ?? ''),
    sku: text(edited.sku ?? p.sku ?? ''),
    brand: text(edited.brand ?? p.brand ?? p.vendor ?? ''),
    category: text(edited.category !== undefined ? edited.category : (p.category || p.product_type || p.productType || '')),
    price: price(),
    cost: cost(),
    stock: text(edited.stock ?? (USE_MOCKS ? (p.stock || '0') : p.stock ?? '')),
  };
}
export type CurrentValues = ReturnType<typeof currentValues>;

/** Texto del buscador: el término tecleado mientras siga siendo la categoría aplicada (E07/E23/E34). */
export function categoryDisplay(category: Value, term: CategoryTerm | null | undefined): string {
  return term && term.forCategory === String(category) ? term.term : String(category);
}

/** Imagen de marcador del producto creado (se mantiene del original). */
export const PLACEHOLDER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect fill='%23f3f4f6' width='80' height='80'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' fill='%239ca3af'%3E%3F%3C/text%3E%3C/svg%3E";

/** handleCreateProduct (E18): se conservan todos los datos del formulario. */
export function buildProductToCreate(edited: PimEdited, fields: CustomField[], now = Date.now()): PimEdited {
  const d = newProductDraft(edited);
  return {
    ...edited,
    id: `new-${now}`,
    name: String(d.name).trim(),
    sku: String(d.sku).trim(),
    brand: d.brand,
    category: d.category,
    description: d.description,
    price: d.price,
    cost: d.cost,
    stock: d.stock,
    customFields: fields,
    image: PLACEHOLDER_IMAGE,
    status: 'draft',
    source: 'uonify',
    channels: { shopify: false, amazon: false, wix: false },
  };
}

/** Canales activos: la cabecera manda (Amazon); si no dice nada, los del producto. */
export function activeChannels(header: Record<string, boolean>, product: PimProduct) {
  const own = (product.channels && typeof product.channels === 'object' ? product.channels : {}) as Record<string, unknown>;
  const pick = (Name: string, name: string) => (header[Name] !== undefined ? header[Name] === true : own[name] === true);
  return { ...own, shopify: pick('Shopify', 'shopify'), amazon: pick('Amazon', 'amazon') };
}

const imageUrl = (image: unknown): string => {
  if (typeof image === 'string') return image;
  const item = image as { url?: unknown; src?: unknown } | null;
  return String(item?.url || item?.src || '');
};

/** Galería de Imágenes (porción `images`) o las imágenes del producto: URLs únicas, como máximo 10. */
export function galleryImages(gallery: unknown, product: PimProduct): string[] {
  const source = Array.isArray(gallery) ? gallery : Array.isArray(product.images) ? product.images : [];
  return source.map(imageUrl).filter((url, index, self) => url && self.indexOf(url) === index).slice(0, 10);
}

/** Viñetas vigentes: la porción `bullets`, las del producto o una vacía. */
export function currentBullets(stored: unknown, product: PimProduct): unknown[] {
  if (Array.isArray(stored)) return stored;
  if (Array.isArray(product.bullets)) return product.bullets;
  if (Array.isArray(product.bullet_points)) return product.bullet_points;
  return [''];
}

/**
 * Datos de «Guardar Cambios» (handleSaveChanges): producto + ediciones +
 * viñetas + galería; precio y coste también donde los lee un producto de
 * Amazon (E25/E26); campos personalizados incluidos (E32).
 */
export function buildDataToSave(input: {
  product: PimProduct;
  edited: PimEdited;
  fields: CustomField[];
  bullets: unknown;
  gallery: unknown;
}): PimEdited {
  const { product, edited, fields } = input;
  const images = galleryImages(input.gallery, product);
  const data: PimEdited = {
    ...product,
    ...edited,
    bullet_points: currentBullets(input.bullets, product).map(bullet => String(bullet ?? '')).filter(bullet => bullet.trim() !== ''),
    images: images.length > 0 ? images : (product.images || []),
  };
  const costPrice = product.cost_price as CostPrice;
  if (edited.price !== undefined && (product.retail_price || product.source === 'amazon')) data.retail_price = edited.price;
  if (edited.cost !== undefined && (costPrice?.amount || product.source === 'amazon')) data.cost_price = { ...(costPrice || {}), amount: edited.cost };
  data.customFields = fields;
  return data;
}
