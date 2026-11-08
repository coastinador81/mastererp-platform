import { api, ApiError, errorMessage } from '@/shared/api/client';
import { PIM_ENDPOINTS, sleep } from '@/shared/pim';
import type { AuditResult, ScrapedProduct } from '../model/types';
import { scrapePayload } from '../model/scrape';

/**
 * Llamadas al backend de la Auditoría IA (services/pim/aiAuditService.ts y
 * productScraperService.ts del original), todas bajo API_BASE con @/shared/api/client.
 *
 * Contrato:
 *   POST /ai-audit          { url }                                   → AuditResult
 *   POST /product-scraper   { url } | { asin } | { ean } + product_id  → ScrapedProduct
 * El original llamaba al scraper en una URL fija de AWS Lambda; aquí pasa por el
 * backend de Uonify en /product-scraper.
 */
export const AUDIT_ENDPOINTS = {
  AI_AUDIT: PIM_ENDPOINTS.AI_AUDIT,
  PRODUCT_SCRAPER: '/product-scraper',
} as const;

/** Tiempo máximo de una auditoría y reintentos (los del original). */
export const AUDIT_TIMEOUT_MS = 90_000;
export const AUDIT_MAX_ATTEMPTS = 2;
export const AUDIT_RETRY_DELAY_MS = 2000;

/** Error de tiempo agotado (en el original, «timeout of 90000ms exceeded» de axios). */
export class AuditTimeoutError extends Error {
  readonly code = 'ECONNABORTED';
  constructor(timeout: number) {
    super(`La auditoría ha superado el tiempo máximo de espera (${Math.round(timeout / 1000)} s).`);
    this.name = 'AuditTimeoutError';
  }
}

async function postWithTimeout<T>(path: string, body: unknown, timeout: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await api.post<T>(path, body, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new AuditTimeoutError(timeout);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Solo se reintenta si se agotó el tiempo o el servidor falló (5xx). */
const retryable = (error: unknown): boolean =>
  error instanceof AuditTimeoutError || (error instanceof ApiError && error.status >= 500);

/** aiAuditService.auditProduct: 2 intentos, reintento a los 2 s si es recuperable. */
export async function auditProduct(url: string): Promise<AuditResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= AUDIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const data = await postWithTimeout<unknown>(AUDIT_ENDPOINTS.AI_AUDIT, { url }, AUDIT_TIMEOUT_MS);
      // A04: un 2xx sin cuerpo útil se pinta con valores vacíos.
      return data && typeof data === 'object' ? (data as AuditResult) : {};
    } catch (error) {
      lastError = error;
      if (attempt < AUDIT_MAX_ATTEMPTS && retryable(error)) {
        await sleep(AUDIT_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/** productScraperService.scrapeProduct. */
export function scrapeProduct(input: string, productId?: string): Promise<ScrapedProduct | null> {
  return api.post<ScrapedProduct | null>(AUDIT_ENDPOINTS.PRODUCT_SCRAPER, scrapePayload(input, productId));
}

/** Mensaje de un fallo del análisis: el `error` del backend si es una frase, si no el mensaje. */
export function scrapeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const data = error.data as { error?: unknown } | null;
    const text = data && typeof data.error === 'string' && /\s/.test(data.error) ? data.error : null;
    return text ?? errorMessage(error, 'Error al procesar la URL');
  }
  return errorMessage(error, 'Error al procesar la URL');
}

/** Mensaje de un fallo de la auditoría. */
export const auditErrorMessage = (error: unknown): string => errorMessage(error, 'No se ha podido completar la auditoría.');
