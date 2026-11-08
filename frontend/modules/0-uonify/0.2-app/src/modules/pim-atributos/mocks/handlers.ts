import { http } from 'msw';
import { collection, record } from '@/shared/mocks/db';
import { HttpResponse, fail, latency, mock } from '@/shared/mocks/utils';
import { MARKETPLACE } from '@/shared/pim';
import { searchProductTypeFixtures } from './fixtures/productTypes';
import { listingIssues, simulatedTitle } from './fixtures/simulated';

/**
 * Simulación de los servicios de la pestaña Atributos (rutas del prototipo
 * pim/atributos.js bajo API_BASE). Éxito por defecto, con latencia realista y
 * datos guardados en sessionStorage (@/shared/mocks/db):
 *   GET  /amazon/product-types/search   categorías de Amazon.es
 *   POST /bullet-point                  título con Uony (action 'generate_title')
 *   POST /stock/bulk · POST /update-stock   stock por EDI
 *   GET/POST /shopify/products · PUT /shopify/products/:id
 *   PUT  /amazon/products               crear o actualizar un listing
 */

// En las pruebas no se espera: la latencia solo sirve para ver los estados de carga.
const wait = (ms: number) => latency(import.meta.env.MODE === 'test' ? 0 : ms);

interface Listing { id: string; [field: string]: unknown }
interface ShopifyProduct { id: string; variants?: Array<{ sku?: unknown }>; [field: string]: unknown }
type StockLevel = { amazon_vendor: { available: boolean; qty_on_hand: number; updated_at: string }; channel: string };

const listings = collection<Listing>('amazon-listings');
const shopifyProducts = collection<ShopifyProduct>('shopify-products');
const stockLevels = record<Record<string, StockLevel>>('stock-levels', () => ({}));

const nowIso = () => new Date().toISOString();
const submissionId = () => `sub-${Math.random().toString(36).slice(2, 10)}`;
const numericId = () => String(Date.now()).concat(String(Math.floor(Math.random() * 90) + 10));
const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

export const handlers = [
  http.get(mock('/amazon/product-types/search'), async ({ request }) => {
    const keywords = new URL(request.url).searchParams.get('keywords') ?? '';
    await wait(350);
    const productTypes = searchProductTypeFixtures(keywords).map(type => ({ ...type, marketplaceIds: [MARKETPLACE.id] }));
    return HttpResponse.json({ productTypes, productTypeVersion: 'LATEST' });
  }),

  http.post(mock('/bullet-point'), async ({ request }) => {
    const body = asObject(await request.json());
    await wait(1200);
    if (body.action !== 'generate_title') return fail(400, 'Acción no admitida por el servicio de títulos.', 'unsupported_action');
    return HttpResponse.json({ title: simulatedTitle(body) });
  }),

  http.post(mock('/stock/bulk'), async ({ request }) => {
    const body = asObject(await request.json());
    const skus = Array.isArray(body.skus) ? body.skus.map(String) : [];
    await wait(600);
    const levels = stockLevels.get();
    const stock_data: Record<string, StockLevel> = {};
    skus.forEach(sku => {
      stock_data[sku] = levels[sku] ?? {
        amazon_vendor: { available: true, qty_on_hand: 24, updated_at: nowIso() },
        channel: String(body.channel || 'amazon'),
      };
    });
    stockLevels.set({ ...levels, ...stock_data });
    return HttpResponse.json({ stock_data });
  }),

  http.post(mock('/update-stock'), async ({ request }) => {
    const body = asObject(await request.json());
    const sku = String(body.sku ?? '');
    if (!sku) return fail(400, 'Falta el SKU del producto.', 'missing_sku');
    const qty = Number(body.qty_on_hand) || 0;
    await wait(700);
    stockLevels.update(levels => ({
      ...levels,
      [sku]: { amazon_vendor: { available: qty > 0, qty_on_hand: qty, updated_at: nowIso() }, channel: levels[sku]?.channel ?? 'amazon' },
    }));
    return HttpResponse.json({ message: 'Stock actualizado vía EDI', sku, qty_on_hand: qty });
  }),

  http.get(mock('/shopify/products'), async () => {
    await wait(400);
    return HttpResponse.json({ statusCode: 200, body: { products: shopifyProducts.all() } });
  }),

  http.post(mock('/shopify/products'), async ({ request }) => {
    const body = asObject(await request.json());
    await wait(800);
    const product = shopifyProducts.upsert({ ...body, id: numericId(), created_at: nowIso() });
    return HttpResponse.json({ statusCode: 200, body: { product } });
  }),

  http.put(mock('/shopify/products/:id'), async ({ params, request }) => {
    const body = asObject(await request.json());
    await wait(700);
    const id = String(params.id);
    const product = shopifyProducts.upsert({ ...(shopifyProducts.get(id) ?? {}), ...body, id, updated_at: nowIso() });
    return HttpResponse.json({ product });
  }),

  http.put(mock('/amazon/products'), async ({ request }) => {
    const body = asObject(await request.json());
    await wait(900);
    const issues = listingIssues(body);
    const sku = String(body.sku ?? '');
    if (issues.some(issue => issue.severity === 'ERROR')) {
      return HttpResponse.json({ sku, status: 'INVALID', submissionId: submissionId(), issues });
    }
    listings.upsert({ ...(listings.get(sku) ?? {}), ...body, id: sku, status: 'ACCEPTED', updatedAt: nowIso() });
    return HttpResponse.json({ sku, status: 'ACCEPTED', submissionId: submissionId(), issues });
  }),
];
