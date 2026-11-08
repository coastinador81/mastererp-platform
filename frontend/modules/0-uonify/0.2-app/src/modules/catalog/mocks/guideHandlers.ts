import { http } from 'msw';
import { record } from '@/shared/mocks/db';
import { HttpResponse, fail, latency, mock } from '@/shared/mocks/utils';
import { GUIDE_FOLDER, normalise } from '../guide/model';
import type { CatalogProduct } from '../model/types';
import { sampleProduct, sampleSlices, SAMPLE_SKU, SAMPLE_VERSION } from './fixtures/sampleProduct';

// Adaptador de escenario local. No realiza OAuth, lectura de Drive ni envíos a Amazon.
const connections = record<Record<string, string[]>>('guide-connections', () => ({}));
const receipts = record<Record<string, CatalogProduct>>('guide-publications', () => ({}));
export function guideHandlers(db: { get(): CatalogProduct[]; set(data: CatalogProduct[]): void }) {
  return [
    http.post(mock('/product-guides/connections/:provider'), async ({ request, params }) => {
      const { threadId } = await request.json() as { threadId: string };
      if (!threadId || !['amazon', 'drive'].includes(String(params.provider))) return fail(400, 'Selecciona una conexión válida.');
      await latency(300);
      connections.set({ ...connections.get(), [threadId]: [...new Set([...(connections.get()[threadId] || []), String(params.provider)])] });
      return HttpResponse.json({ connected: true });
    }),
    http.post(mock('/product-guides/source'), async ({ request }) => {
      const { folder, threadId } = await request.json() as { folder: string; threadId: string };
      if (!connections.get()[threadId]?.includes('drive')) return fail(403, 'Conecta Google Drive para elegir una carpeta.');
      await latency(350);
      if (!/make it possible|jenga|uon-kit-01/.test(normalise(folder || ''))) {
        return fail(404, 'No encuentro esa carpeta. Selecciona «Uonify / Make It Possible» para continuar con este producto.');
      }
      return HttpResponse.json({ folder: GUIDE_FOLDER, files: [
        { name: 'Make It Possible · Datos del producto', kind: 'Ficha y características' },
        { name: 'Galería del producto', kind: '8 imágenes' },
        { name: 'Contenido de marca', kind: '5 módulos A+' },
        { name: 'Todo empieza jugando', kind: 'Vídeo · 27 s' },
      ] });
    }),
    http.post(mock('/product-guides/prepare'), async ({ request }) => {
      const { threadId } = await request.json() as { threadId: string };
      if ((connections.get()[threadId] || []).length < 2) return fail(403, 'Conecta Amazon y Google Drive antes de continuar.');
      await latency(650);
      const existing = db.get().find(product => product.sku === SAMPLE_SKU);
      const product = existing || { ...sampleProduct(), createdAt: Date.now() };
      if (!existing) db.set([product, ...db.get()]);
      return HttpResponse.json({ product, sample: { id: SAMPLE_SKU, version: SAMPLE_VERSION, slices: sampleSlices() } });
    }),
    http.post(mock('/product-guides/publish'), async ({ request }) => {
      const { threadId, product, approvalId } = await request.json() as { threadId: string; product: CatalogProduct; approvalId: string };
      if (!connections.get()[threadId]?.includes('amazon')) return fail(403, 'Vuelve a conectar Amazon.');
      if (!approvalId || product?.sku !== SAMPLE_SKU || !product.name?.trim()) return fail(400, 'Revisa la ficha antes de publicarla.');
      const key = `${threadId}:${approvalId}`;
      const previous = receipts.get()[key];
      if (previous) return HttpResponse.json({ product: previous, status: 'published' });
      await latency(900);
      const saved = { ...product, status: 'published' };
      db.set(db.get().map(item => item.sku === SAMPLE_SKU ? saved : item));
      receipts.set({ ...receipts.get(), [key]: saved });
      return HttpResponse.json({ product: saved, status: 'published' });
    }),
  ];
}
