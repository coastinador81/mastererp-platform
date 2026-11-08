import { USE_MOCKS } from '@/shared/api/config';
import { api, ApiError, errorMessage } from '@/shared/api/client';
import { MARKETPLACE, PIM_ENDPOINTS, type PimEdited } from '@/shared/pim';
import type { CatalogProduct, SampleDefinition } from '../model/types';

/**
 * Llamadas del servicio Producto (contrato del backend; bajo API_BASE):
 *   GET    /products                         → { products: CatalogProduct[] }   (más recientes primero)
 *   POST   /products        body: producto   → { product }   400 nombre/SKU · 409 SKU de otro producto
 *   PATCH  /products/:sku   body: cambios    → { product }   (puede cambiar el SKU) 404 · 409
 *   DELETE /products/:sku                    → { ok: true }
 *   GET    /samples/:id                      → { id, version, slices }  (porciones del producto de ejemplo)
 *   GET    /amazon/product-types/search?keywords&marketplace_id&country_code
 *                                            → { productTypes: [{ name, displayName, marketplaceIds }], productTypeVersion }
 * Los errores llevan { error, message } con el mensaje en español que ve la persona.
 */
export const PRODUCTS_PATH = '/products';
export const SAMPLES_PATH = '/samples';

const productPath = (sku: string) => `${PRODUCTS_PATH}/${encodeURIComponent(sku)}`;

/** Convierte un error de la API en un Error con el mensaje del backend (como el prototipo). */
function readable(error: unknown): Error {
  if (error instanceof ApiError) return new Error(errorMessage(error));
  return error instanceof Error ? error : new Error(errorMessage(error));
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw readable(error);
  }
}

export function listProducts(): Promise<CatalogProduct[]> {
  return call(async () => (await api.get<{ products: CatalogProduct[] }>(PRODUCTS_PATH)).products ?? []);
}

const livePayload = (data: PimEdited) => USE_MOCKS ? data : Object.fromEntries(Object.entries(data).filter(([key]) => ['name','sku','brand','category','description','keywords','price','cost','stock','customFields','bullets','revision','gpsr'].includes(key)));

export function createProduct(data: PimEdited): Promise<CatalogProduct> {
  return call(async () => (await api.post<{ product: CatalogProduct }>(PRODUCTS_PATH, livePayload(data))).product);
}

export function updateProduct(sku: string, data: PimEdited): Promise<CatalogProduct> {
  return call(async () => (await api.patch<{ product: CatalogProduct }>(productPath(sku), livePayload(data))).product);
}

export function deleteProduct(sku: string): Promise<void> {
  return call(async () => {
    await api.delete(productPath(sku));
  });
}

export function getSample(id: string): Promise<SampleDefinition> {
  return call(() => api.get<SampleDefinition>(`${SAMPLES_PATH}/${encodeURIComponent(id)}`));
}

export interface ProductTypeResult {
  name: string;
  displayName?: string;
  marketplaceIds?: string[];
}

export interface ProductTypeSearch {
  productTypes: ProductTypeResult[];
  productTypeVersion?: string;
}

/**
 * Búsqueda de categorías de Amazon (ctx.categorySearch). Devuelve el cuerpo y,
 * como el `api` del prototipo (axios), también `{ status, data }`: las pestañas
 * portadas leen `respuesta.data.productTypes` o `respuesta.productTypes`.
 */
export async function searchProductTypes(keywords: string): Promise<ProductTypeSearch & { status: number; data: ProductTypeSearch }> {
  const body = await call(() => api.get<ProductTypeSearch>(PIM_ENDPOINTS.AMAZON_PRODUCT_TYPES_SEARCH, {
    params: { keywords, marketplace_id: MARKETPLACE.id, country_code: MARKETPLACE.countryCode },
  }));
  return { ...body, status: 200, data: body };
}
