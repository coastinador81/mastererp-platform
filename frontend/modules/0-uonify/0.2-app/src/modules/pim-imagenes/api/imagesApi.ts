import { api, ApiError } from '@/shared/api/client';
import { MARKETPLACE } from '@/shared/api/config';
import { buildPrompt, getDimensions } from '../model/prompt';
import { ABSOLUTE_URL_PATTERN, buildImageProxyUrl, isImageProxyUrl, proxyTarget } from '../model/proxy';
import type { CatalogImage, Dimensions, StyleConfig } from '../model/types';
import { AI_GENERATOR_TIMEOUT, amazonCatalogImagesPath, IMAGES_ENDPOINTS, SCRAPER_TIMEOUT } from './endpoints';

/**
 * Llamadas al backend de la pestaña «Imágenes» (prototipo: imageScraperService.ts,
 * aiImageGeneratorService.ts, amazonCatalogService.ts e imageProxyService.ts dentro
 * de pim/imagenes.js). La sesión viaja en la cookie del backend.
 */

/** `timeout` de axios: aborta la petición y falla con un mensaje propio. */
async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Tiempo de espera agotado (${Math.round(ms / 1000)} s)`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Mensaje que manda el backend en un error ({ error, message }), si lo hay. */
function backendMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const data = error.data as { message?: unknown } | null;
  return data && typeof data.message === 'string' && data.message.trim() ? data.message : null;
}

export interface ScrapeResult {
  success?: boolean;
  url?: string;
  images?: string[];
  total?: number;
}

/**
 * POST /image-scraper {url, product_id}. Las imágenes externas vuelven envueltas en
 * el image-proxy. Un error HTTP falla con el mensaje del backend.
 */
export async function scrapeImagesFromUrl(url: string, productId: string): Promise<ScrapeResult> {
  try {
    const data = await withTimeout(SCRAPER_TIMEOUT, signal =>
      api.post<ScrapeResult>(IMAGES_ENDPOINTS.IMAGE_SCRAPER, { url, product_id: productId }, { signal }));
    if (data && Array.isArray(data.images)) return { ...data, images: data.images.map(imgUrl => buildImageProxyUrl(imgUrl)) };
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw new Error(backendMessage(error) ?? `La petición ha fallado (${error.status})`, { cause: error });
    throw error;
  }
}

export interface GeneratedImage {
  id?: string;
  url: string;
  name?: string;
  size?: number;
  type?: string;
  style?: string;
  prompt?: string;
  dimensions?: Dimensions;
  styleConfig?: StyleConfig;
}

export interface GenerateResult {
  success?: boolean;
  images?: GeneratedImage[];
  error?: string;
}

export interface GenerateProductData {
  id?: unknown;
  description?: unknown;
  category?: unknown;
  product_type?: unknown;
  brand?: unknown;
}

/** POST /ai-image-generator (Uony genera `numImages` imágenes del producto). */
export async function generateImages(
  productName: string,
  productData: GenerateProductData,
  styleConfig: StyleConfig,
  numImages = 3,
): Promise<GenerateResult> {
  const request = {
    product_name: productName,
    product_description: productData?.description,
    product_category: productData?.category || productData?.product_type,
    style_config: styleConfig,
    dimensions: getDimensions(styleConfig.aspectRatio),
    prompt: buildPrompt(productName, productData, styleConfig),
    num_images: numImages,
    product_id: productData?.id,
  };
  try {
    return await withTimeout(AI_GENERATOR_TIMEOUT, signal =>
      api.post<GenerateResult>(IMAGES_ENDPOINTS.AI_IMAGE_GENERATOR, request, { signal }));
  } catch (error) {
    throw new Error(backendMessage(error) || 'Error al generar imágenes con Uony', { cause: error });
  }
}

export interface CatalogImagesResponse {
  asin?: string;
  marketplace_id?: string;
  images?: CatalogImage[];
  total_images?: number;
}

// Caché por ASIN durante la sesión, sin caducidad (como el original).
const catalogImagesCache = new Map<string, CatalogImagesResponse>();

/** GET /amazon/catalog/{asin}/images. Un error HTTP falla con «HTTP error! status: N». */
export async function getCatalogImages(asin: string): Promise<CatalogImagesResponse> {
  const cached = catalogImagesCache.get(asin);
  if (cached) return cached;
  let data: CatalogImagesResponse;
  try {
    data = await api.get<CatalogImagesResponse>(amazonCatalogImagesPath(asin), {
      params: { marketplace_id: MARKETPLACE.id, country_code: MARKETPLACE.countryCode },
    });
  } catch (error) {
    if (error instanceof ApiError) throw new Error(`HTTP error! status: ${error.status}`, { cause: error });
    throw error;
  }
  catalogImagesCache.set(asin, data);
  return data;
}

export const clearCatalogImagesCache = (): void => catalogImagesCache.clear();

/**
 * La imagen como Blob para descargarla: las externas siempre por el image-proxy
 * (sin envolver dos veces); data: y rutas locales se leen en el navegador.
 */
export async function fetchImageBlob(url: string): Promise<Blob> {
  const target = isImageProxyUrl(url) ? proxyTarget(url) : ABSOLUTE_URL_PATTERN.test(url) ? url : null;
  if (target) return api.get<Blob>(IMAGES_ENDPOINTS.IMAGE_PROXY, { params: { url: target }, responseType: 'blob' });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}
