import { http } from 'msw';
import { guideHandlers } from './guideHandlers';
import { record } from '@/shared/mocks/db';
import { HttpResponse, fail, latency, mock } from '@/shared/mocks/utils';
import type { PimEdited } from '@/shared/pim';
import { MSG_NOT_FOUND, MSG_REQUIRED, MSG_SKU_TAKEN, saveInCatalog } from '../model/catalogRules';
import type { CatalogProduct } from '../model/types';
import { SAMPLE_SKU, SAMPLE_VERSION, sampleProduct, sampleSlices } from './fixtures/sampleProduct';

/**
 * Simulación del backend del servicio Producto (contrato en api/products.ts).
 * El catálogo vive en sessionStorage (uonify-mock:catalog-products): el producto de
 * ejemplo entra una vez por sesión y, si se elimina, no vuelve en esa sesión.
 * La búsqueda de categorías de Amazon (ctx.categorySearch) la simula pim-atributos.
 */
export const catalogDb = record<CatalogProduct[]>('catalog-products', () => [{ ...sampleProduct(), createdAt: Date.now() }]);

const SAMPLES: Record<string, { version: number; slices: () => Record<string, unknown> }> = {
  [SAMPLE_SKU]: { version: SAMPLE_VERSION, slices: sampleSlices },
};

/** Traduce un error de las reglas del catálogo a la respuesta del backend. */
function saveError(error: unknown) {
  const message = error instanceof Error ? error.message : MSG_REQUIRED;
  if (message === MSG_SKU_TAKEN) return fail(409, message, 'sku_taken');
  return fail(400, message, 'invalid_product');
}

async function readBody(request: Request): Promise<PimEdited> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as PimEdited) : {};
  } catch {
    return {};
  }
}

export const handlers = [
  ...guideHandlers(catalogDb),
  http.get(mock('/products'), async () => {
    await latency(380);
    return HttpResponse.json({ products: catalogDb.get() });
  }),

  http.post(mock('/products'), async ({ request }) => {
    const data = await readBody(request);
    await latency(520);
    try {
      const { products, saved } = saveInCatalog(catalogDb.get(), data, { target: null });
      catalogDb.set(products);
      return HttpResponse.json({ product: saved }, { status: 201 });
    } catch (error) {
      return saveError(error);
    }
  }),

  http.patch(mock('/products/:sku'), async ({ request, params }) => {
    const target = decodeURIComponent(String(params.sku));
    const data = await readBody(request);
    await latency(480);
    const current = catalogDb.get();
    if (!current.some(item => item.sku === target)) return fail(404, MSG_NOT_FOUND, 'not_found');
    try {
      const { products, saved } = saveInCatalog(current, data, { target });
      catalogDb.set(products);
      return HttpResponse.json({ product: saved });
    } catch (error) {
      return saveError(error);
    }
  }),

  http.delete(mock('/products/:sku'), async ({ params }) => {
    const target = decodeURIComponent(String(params.sku));
    await latency(320);
    const current = catalogDb.get();
    if (!current.some(item => item.sku === target)) return fail(404, MSG_NOT_FOUND, 'not_found');
    catalogDb.set(current.filter(item => item.sku !== target));
    return HttpResponse.json({ ok: true });
  }),

  http.get(mock('/samples/:id'), async ({ params }) => {
    const id = decodeURIComponent(String(params.id));
    const sample = SAMPLES[id];
    await latency(260);
    if (!sample) return fail(404, 'Este producto de ejemplo no existe.', 'not_found');
    return HttpResponse.json({ id, version: sample.version, slices: sample.slices() });
  }),
];
