import { http } from 'msw';
import { collection } from '@/shared/mocks/db';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { AUDIT_ENDPOINTS } from '../api/auditApi';
import { buildAuditResult } from './fixtures/auditFixtures';
import { isAnalyzableInput, normalizeInput } from './fixtures/detect';
import { buildScrapedProduct } from './fixtures/scrapeFixtures';

/**
 * Simulación del backend de la Auditoría IA:
 *   POST /api/ai-audit         { url }                                  → resultado de la auditoría
 *   POST /api/product-scraper  { url } | { asin } | { ean } + product_id → producto extraído
 * Cada análisis se guarda (sessionStorage) y la misma entrada devuelve siempre lo mismo,
 * como haría un backend con caché. Latencias realistas: la auditoría tarda unos segundos
 * (la pestaña enseña su progreso) y la extracción algo menos.
 */
export const AUDIT_LATENCY_MS = 3600;
export const SCRAPE_LATENCY_MS = 1800;
const ERROR_LATENCY_MS = 400;

interface StoredRun {
  id: string;
  kind: 'audit' | 'scrape';
  input: string;
  productId?: string;
  response: Record<string, unknown>;
  createdAt: string;
}

export const auditRuns = collection<StoredRun>('pim-auditoria:runs');

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Respuesta guardada para esta entrada o una nueva (y se guarda). */
function cached(kind: StoredRun['kind'], input: string, build: () => Record<string, unknown>, productId?: string): Record<string, unknown> {
  const id = `${kind}:${normalizeInput(input)}`;
  const stored = auditRuns.get(id);
  if (stored) return stored.response;
  const response = build();
  auditRuns.upsert({ id, kind, input, productId, response, createdAt: new Date().toISOString() });
  return response;
}

export const handlers = [
  http.post(mock(AUDIT_ENDPOINTS.AI_AUDIT), async ({ request }) => {
    const url = text((await readBody(request)).url);
    if (!url) {
      await latency(ERROR_LATENCY_MS);
      return fail(400, 'Falta la URL, el ASIN o el EAN del producto.', 'bad_request');
    }
    if (!isAnalyzableInput(url)) {
      await latency(ERROR_LATENCY_MS);
      return fail(422, `No se ha podido auditar «${url}»: indica una URL, un ASIN o un EAN.`, 'invalid_input');
    }
    await latency(AUDIT_LATENCY_MS);
    return HttpResponse.json(cached('audit', url, () => buildAuditResult(url)));
  }),

  http.post(mock(AUDIT_ENDPOINTS.PRODUCT_SCRAPER), async ({ request }) => {
    const body = await readBody(request);
    const input = text(body.url) || text(body.asin) || text(body.ean);
    const productId = text(body.product_id) || undefined;
    if (!input) {
      await latency(ERROR_LATENCY_MS);
      return fail(400, 'Falta la URL, el ASIN o el EAN del producto.', 'bad_request');
    }
    if (!isAnalyzableInput(input)) {
      await latency(ERROR_LATENCY_MS);
      return fail(422, `No se reconoce «${input}» como URL, ASIN ni EAN.`, 'invalid_input');
    }
    await latency(SCRAPE_LATENCY_MS);
    return HttpResponse.json(cached('scrape', input, () => buildScrapedProduct(input), productId));
  }),
];
