import type { FieldMap, ScrapedProduct } from './types';

/**
 * Paso «1. Analiza» (handleStartScraping del original y productScraperService.scrapeProduct):
 * qué se envía al servicio de extracción y cómo se convierten sus datos en campos editables.
 */

export type ScrapeInputKind = 'ean' | 'asin' | 'url';

export const isEAN = (input: string): boolean => /^\d{8,14}$/.test(input.trim());
export const isASIN = (input: string): boolean => /^B0[A-Z0-9]{8}$/i.test(input.trim());

/** EAN (8-14 dígitos), ASIN (B0 + 8) o URL/texto. */
export function inputKind(input: string): ScrapeInputKind {
  if (isEAN(input)) return 'ean';
  if (isASIN(input)) return 'asin';
  return 'url';
}

export interface ScrapePayload {
  url?: string;
  asin?: string;
  ean?: string;
  product_id?: string;
}

/** Cuerpo de la petición: { ean } | { asin } | { url } + product_id del producto abierto. */
export function scrapePayload(input: string, productId?: string): ScrapePayload {
  const kind = inputKind(input);
  const payload: ScrapePayload = {};
  if (kind === 'ean') payload.ean = input.trim();
  else if (kind === 'asin') payload.asin = input.trim();
  else payload.url = input;
  if (productId) payload.product_id = productId;
  return payload;
}

/**
 * Mensaje de error de la validación previa, o null si se puede analizar: vacío, o
 * algo que parece una URL (http / www.) pero no lo es.
 */
export function scrapeInputError(input: string): string | null {
  if (!input.trim()) return 'Por favor ingresa una URL, ASIN o EAN válido';
  const looksLikeUrl = input.includes('http') || input.includes('www.');
  if (looksLikeUrl) {
    try {
      new URL(input);
    } catch {
      return 'URL inválida. Debe incluir http:// o https://';
    }
  }
  return null;
}

/** Campos editables a partir del producto extraído (mismas claves que el original). */
export function mapScrapedProduct(scraped: ScrapedProduct): FieldMap {
  const mapped: FieldMap = {};
  if (scraped.title) mapped.nombre = scraped.title;
  if (scraped.sku) mapped.sku = scraped.sku;
  if (scraped.ean) mapped.ean = scraped.ean;
  if (scraped.brand) mapped.marca = scraped.brand;
  if (scraped.price) mapped.precio = scraped.price;
  if (scraped.description) mapped.descripcion = scraped.description;
  if (scraped.long_description && scraped.long_description !== scraped.description) {
    mapped.descripcion_larga = scraped.long_description;
  }
  if (scraped.dimensions && typeof scraped.dimensions === 'object') {
    Object.entries(scraped.dimensions).forEach(([dimension, value]) => { if (value) mapped[dimension] = value; });
  }
  if (scraped.specifications && typeof scraped.specifications === 'object') {
    Object.entries(scraped.specifications).forEach(([spec, value]) => { if (value && !mapped[spec]) mapped[spec] = value; });
  }
  return mapped;
}

/** El producto extraído sirve (sin error y con título); si no, el mensaje de error. */
export function scrapedProductError(scraped: ScrapedProduct | null | undefined): string | null {
  if (scraped?.error) return String(scraped.error);
  if (!scraped || !scraped.title) return 'No se pudieron extraer datos del producto. Verifica que la URL sea válida.';
  return null;
}
