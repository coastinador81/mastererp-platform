import { IMAGE_PROXY_PATH } from '../model/proxy';

/**
 * Rutas del backend de la pestaña «Imágenes», todas bajo API_BASE con
 * @/shared/api/client. Contrato (lo simula mocks/handlers.ts):
 *
 * - POST /image-scraper  {url, product_id}
 *     → { success, url, product_id, images: string[] (URLs absolutas), total }        (60 s)
 *   Prototipo: POST {IMAGE_SCRAPER_BACKEND} (imageScraperService.ts).
 * - POST /ai-image-generator  {product_name, product_description, product_category,
 *     style_config, dimensions, prompt, num_images: 3, product_id}
 *     → { success, images: [{id, url, name, size, type, style, prompt, dimensions, styleConfig}] }  (120 s)
 *   Prototipo: POST {AI_IMAGE_GENERATOR_BACKEND} (aiImageGeneratorService.ts).
 * - GET /amazon/catalog/{asin}/images
 *     → { asin, marketplace_id, images: [{variant, link, height, width}], total_images }
 *   Prototipo: amazonCatalogService.ts (el backend ya la tiene: routes/amazon_catalog.py).
 * - GET /amazon/aplus/image-proxy?url=…  → la imagen (blob)
 *   Prototipo: imageProxyService.ts (backend: routes/amazon_aplus.py, get_aplus_image).
 *
 * En el prototipo el scraper y el generador eran lambdas con su propia URL y sin
 * ruta; aquí se les da ruta propia bajo la API de Uonify.
 */
export const IMAGES_ENDPOINTS = {
  IMAGE_SCRAPER: '/image-scraper',
  AI_IMAGE_GENERATOR: '/ai-image-generator',
  AMAZON_CATALOG_IMAGES: '/amazon/catalog/:asin/images',
  IMAGE_PROXY: IMAGE_PROXY_PATH,
} as const;

export const amazonCatalogImagesPath = (asin: string): string =>
  IMAGES_ENDPOINTS.AMAZON_CATALOG_IMAGES.replace(':asin', encodeURIComponent(asin));

/** Tiempos máximos del original (axios `timeout`). */
export const SCRAPER_TIMEOUT = 60_000;
export const AI_GENERATOR_TIMEOUT = 120_000;
