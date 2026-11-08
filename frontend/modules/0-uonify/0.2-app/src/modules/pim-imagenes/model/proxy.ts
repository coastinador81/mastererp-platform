import { apiUrl } from '@/shared/api/config';

/**
 * Proxy de imágenes del backend (prototipo: imageProxyService.ts dentro de
 * pim/imagenes.js). Las imágenes externas se piden a través de
 * GET {API_BASE}/amazon/aplus/image-proxy?url=… para evitar CORS al pintarlas en
 * un lienzo y al descargarlas.
 */
export const IMAGE_PROXY_PATH = '/amazon/aplus/image-proxy';

export const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

/** Si la URL ya es del image-proxy (IMG-19: no se envuelve dos veces). */
export const isImageProxyUrl = (imageUrl: unknown): boolean => String(imageUrl).includes(`${IMAGE_PROXY_PATH}?`);

/** URL del proxy para una imagen absoluta; las data:, blob: y relativas quedan igual. */
export function buildImageProxyUrl(imageUrl: string): string {
  if (!imageUrl || !ABSOLUTE_URL_PATTERN.test(imageUrl) || isImageProxyUrl(imageUrl)) return imageUrl;
  return `${apiUrl(IMAGE_PROXY_PATH)}?url=${encodeURIComponent(imageUrl)}`;
}

/** La imagen original de una URL del proxy (o null si no lo es). */
export function proxyTarget(proxyUrl: string): string | null {
  if (!isImageProxyUrl(proxyUrl)) return null;
  try {
    return new URL(proxyUrl, 'http://uonify.invalid').searchParams.get('url');
  } catch {
    return null;
  }
}
