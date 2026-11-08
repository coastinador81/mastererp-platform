import { api } from '@/shared/api/client';
import { PIM_ENDPOINTS, pimStore } from '@/shared/pim';
import { COUNTRY_CODE, MARKETPLACE_ID, mapInternalToAmazon } from '../model/productMapper';
import type { AmazonListingResponse, CategoryOption, ProductLike, StockData } from '../model/types';
import { apiErrorText, timed, unwrapBody } from './http';

/**
 * Llamadas de la pestaña Atributos, todas bajo API_BASE (contrato del backend,
 * rutas del prototipo pim/atributos.js):
 *   POST /bullet-point                     { action: 'generate_title', product_name, brand, category } → { title }
 *   GET  /amazon/product-types/search      ?keywords&marketplace_id&country_code → { productTypes: [{ name, displayName }] }
 *   POST /stock/bulk                       { skus: [id], channel } → { stock_data: { [id]: StockData } }
 *   POST /update-stock                     { sku, ean, qty_on_hand, price } → { message }
 *   GET  /shopify/products?limit=250       → { body: { products } } (duplicados por SKU)
 *   POST /shopify/products · PUT /shopify/products/{id}
 *   PUT  /amazon/products                  crear (mapInternalToAmazon) o actualizar un listing
 * Los timeouts son los del original (axios: 300 s; IA: 60 s).
 */

/** Listings de Amazon (PUT crea o actualiza; la pestaña GPSR usa PATCH). */
export const AMAZON_LISTING_PATH = '/amazon/products';
const AXIOS_TIMEOUT = 300_000;
const AI_TIMEOUT = 60_000;

/** services/pim/aiDescriptionsService.ts · generateTitle: título de producto con Uony. */
export async function generateTitle(productData: ProductLike): Promise<string> {
  const payload = {
    action: 'generate_title',
    product_name: productData.name || productData.title || 'Producto',
    brand: productData.brand || '',
    category: productData.category || productData.product_type || '',
  };
  try {
    const response = await timed(AI_TIMEOUT, signal => api.post(PIM_ENDPOINTS.AI_BULLET_POINT, payload, { signal }));
    const data = unwrapBody<{ title?: string; generated_title?: string }>(response);
    const title = data.title || data.generated_title;
    if (!title) throw new Error('La respuesta de Uony no incluyó un título');
    return title;
  } catch (error) {
    throw new Error(apiErrorText(error) || 'Error al generar título con Uony', { cause: error });
  }
}

/** Categorías de Amazon (product types) que coinciden con el texto. */
export async function searchProductTypes(keywords: string, signal?: AbortSignal): Promise<unknown> {
  return api.get(PIM_ENDPOINTS.AMAZON_PRODUCT_TYPES_SEARCH, {
    params: { keywords, marketplace_id: MARKETPLACE_ID, country_code: COUNTRY_CODE },
    signal,
  });
}

/** La lista de categorías de una respuesta (con o sin envoltorio `data`, como axios). */
export function productTypesOf(response: unknown): CategoryOption[] {
  const raw = (response ?? {}) as { productTypes?: unknown; data?: { productTypes?: unknown } };
  const wrapped = raw.data?.productTypes;
  const list: unknown[] = Array.isArray(raw.productTypes) ? raw.productTypes : Array.isArray(wrapped) ? wrapped : [];
  return (list as CategoryOption[]).filter(cat => cat && cat.name);
}

/** Stock de un producto (ProductsPIMInterface.tsx, efecto de selectedProduct). */
export async function loadStock(identifier: string, channel: 'amazon' | 'shopify'): Promise<StockData | null> {
  const response = await api.post<{ stock_data?: Record<string, StockData> }>('/stock/bulk', { skus: [identifier], channel });
  return response?.stock_data?.[identifier] ?? null;
}

/** services/ediService.ts · updateStockViaEDI: nunca rechaza; devuelve éxito y mensaje. */
export async function updateStockViaEDI(update: { sku: unknown; ean: unknown; available: boolean; qty_on_hand?: number; price?: unknown }) {
  try {
    const data = await api.post<{ message?: string }>('/update-stock', {
      sku: update.sku,
      ean: update.ean,
      qty_on_hand: update.available ? (update.qty_on_hand || 1) : 0,
      price: update.price || 0,
    });
    return { success: true, message: data?.message || 'Stock actualizado vía EDI' };
  } catch (error) {
    return { success: false, message: apiErrorText(error) || 'Error actualizando stock' };
  }
}

/** checkShopifyDuplicateBySKU: id del producto de Shopify con ese SKU, o null. */
export async function checkShopifyDuplicateBySKU(sku: unknown): Promise<string | null> {
  try {
    const response = await timed(AXIOS_TIMEOUT, signal => api.get(PIM_ENDPOINTS.SHOPIFY_PRODUCTS, { params: { limit: 250 }, signal }));
    const products = (unwrapBody<{ products?: Array<{ id?: unknown; variants?: Array<{ sku?: unknown }> }> }>(response).products) ?? [];
    const duplicate = products.find(product => product.variants?.some(variant => variant.sku === sku));
    return duplicate?.id ? String(duplicate.id) : null;
  } catch {
    return null;
  }
}

export function createShopifyProduct(data: unknown) {
  return timed(AXIOS_TIMEOUT, signal => api.post<{ statusCode?: number; body?: unknown; error?: string }>(PIM_ENDPOINTS.SHOPIFY_PRODUCTS, data, { signal }));
}

export function updateShopifyProductRequest(productId: string, data: unknown) {
  return timed(AXIOS_TIMEOUT, signal => api.put<{ product?: unknown; error?: string }>(`${PIM_ENDPOINTS.SHOPIFY_PRODUCTS}/${encodeURIComponent(productId)}`, data, { signal }));
}

/** PUT /amazon/products con un listing ya preparado (actualización). */
export async function updateAmazonListingRequest(payload: unknown): Promise<AmazonListingResponse> {
  const response = await timed(AXIOS_TIMEOUT, signal => api.put(AMAZON_LISTING_PATH, payload, { signal }));
  return unwrapBody<AmazonListingResponse>(response);
}

/**
 * Crea el listing (apiService.createAmazonListing, hecho alcanzable): el mismo
 * endpoint con mapInternalToAmazon. El GPSR sale del producto o de su pestaña GPSR.
 */
export async function createAmazonListing(data: ProductLike): Promise<AmazonListingResponse> {
  const storedGpsr = data.sku ? pimStore.get<Record<string, unknown> | null>(String(data.sku), 'gpsr', null) : null;
  const response = await timed(AXIOS_TIMEOUT, signal => api.put(AMAZON_LISTING_PATH, mapInternalToAmazon(data, storedGpsr), { signal }));
  return unwrapBody<AmazonListingResponse>(response);
}
