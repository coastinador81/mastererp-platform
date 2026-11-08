import { describe, expect, it } from 'vitest';
import {
  allImagesOf,
  buildSnapshot,
  derivedOf,
  galleryTotal,
  headTotal,
  listsToSlices,
  loadLists,
  normalizeScraped,
  productInfoOf,
  type ListsEnv,
} from '../model/lists';
import type { ImageItem } from '../model/types';

const env = (patch: Partial<ListsEnv> = {}): ListsEnv => ({
  info: null,
  deleted: new Set(),
  isAlive: url => !String(url).startsWith('blob:'),
  ...patch,
});

const upload: ImageItem = { id: 'u1', url: 'data:image/png;base64,AA', name: 'foto.png', source: 'upload', status: 'pending', size: 2048 };
const scraped: ImageItem = { id: 's1', url: 'https://tienda.test/a.jpg', name: 'scraped-1.jpg', source: 'scrape', status: 'pending' };
const processed: ImageItem = { id: 'p1', url: '/assets/p.jpg', name: 'Processed foto.png', source: 'upload', status: 'processed', dimensions: { width: 1500, height: 1500 } };
const ai: ImageItem = { id: 'a1', url: '/assets/ai.jpg', name: 'ia-1.jpg', source: 'ai-generated', status: 'generated', style: 'professional' };

describe('listas de la galería (loadLists / derivedOf)', () => {
  it('separa subidas, scrapeadas, procesadas e IA sin duplicar las que tienen porción propia', () => {
    const lists = loadLists({ images: [upload, scraped, processed, ai], processedImages: [processed], aiImages: [ai] }, env());
    expect(lists.uploaded.map(i => i.id)).toEqual(['u1']);
    expect(lists.scraped.map(i => i.id)).toEqual(['s1']);
    expect(lists.processed.map(i => i.id)).toEqual(['p1']);
    expect(lists.ai.map(i => i.id)).toEqual(['a1']);
  });

  it('ADD-02: lo que añade Auditoría IA (source «scraped», sin nombre) se ve como «Scrapeada»', () => {
    const lists = loadLists({ images: [{ id: '', url: 'https://x.test/1.jpg', file: null, source: 'scraped' }] }, env());
    expect(lists.scraped[0]).toMatchObject({ name: 'scraped-1.jpg', source: 'scrape', status: 'pending' });
    expect(lists.scraped[0].id).toMatch(/^scraped-audit-0-/);
    expect(normalizeScraped(scraped, 0)).toBe(scraped);
  });

  it('ADD-02 / IMG-41: las URLs sueltas del producto siguen siendo «Product Image N» de Amazon', () => {
    const info = productInfoOf({ sku: 'UON-1', name: 'X', images: ['https://cdn.test/1.jpg', { url: 'https://cdn.test/2.jpg' }] }, 'UON-1');
    const snapshot = buildSnapshot({ images: ['https://cdn.test/1.jpg', { url: 'https://cdn.test/2.jpg', id: 'raw' }] }, env({ info }), []);
    expect(snapshot.lists.scraped).toEqual([]);
    expect(snapshot.derived.productImages.map(i => i.name)).toEqual(['Product Image 1', 'Product Image 2']);
    expect(snapshot.derived.productImages[0]).toMatchObject({ id: 'product-UON-1-0', source: 'amazon', status: 'ready' });
  });

  it('no duplica URLs del producto que ya están en otro grupo y recuerda las eliminadas por URL', () => {
    const info = productInfoOf({ sku: 'K', name: 'K', images: ['https://cdn.test/a.jpg', 'https://tienda.test/a.jpg', 'https://cdn.test/b.jpg'] }, 'K');
    const lists = loadLists({ images: [scraped] }, env({ info }));
    const derived = derivedOf(lists, env({ info, deleted: new Set(['https://cdn.test/b.jpg']) }));
    expect(derived.productImages.map(i => i.url)).toEqual(['https://cdn.test/a.jpg']);
  });

  it('IMG-40: las imágenes del catálogo de Amazon son del producto con ASIN y van antes que las del producto', () => {
    const info = productInfoOf({ sku: 'A', name: 'A', asin: 'B0TEST', source: 'amazon', images: ['https://m.test/main.jpg', 'https://cdn.test/x.jpg'] }, 'A');
    const catalog = [{ variant: 'MAIN', link: 'https://m.test/main.jpg', width: 2000, height: 2000 }, { variant: 'PT01', link: '' }];
    const snapshot = buildSnapshot({}, env({ info, catalog }), []);
    expect(snapshot.derived.amazonImages).toEqual([
      expect.objectContaining({ id: 'amazon-catalog-A-0', name: 'Amazon MAIN Image', dimensions: { width: 2000, height: 2000 } }),
    ]);
    expect(snapshot.derived.productImages.map(i => i.url)).toEqual(['https://cdn.test/x.jpg']);
    expect(derivedOf(snapshot.lists, env({ info: { ...info!, asin: null }, catalog })).amazonImages).toEqual([]);
  });

  it('tras recargar suelta las URLs blob: que ya no existen', () => {
    const lists = loadLists({ images: [{ ...upload, url: 'blob:http://x/1' }], processedImages: [{ ...processed, url: 'blob:http://x/2' }] }, env());
    expect(lists.uploaded).toEqual([]);
    expect(lists.processed).toEqual([]);
    const alive = loadLists({ processedImages: [{ ...processed, url: 'blob:http://x/2' }] }, env({ isAlive: () => true }));
    expect(alive.processed).toHaveLength(1);
  });

  it('guarda la galería completa en el orden del original y sin File', () => {
    const info = productInfoOf({ sku: 'K', name: 'K', images: ['https://cdn.test/p.jpg'] }, 'K');
    const lists = loadLists({ images: [{ ...upload, file: {} }, scraped], processedImages: [processed], aiImages: [ai] }, env({ info }));
    const slices = listsToSlices(lists, env({ info }));
    expect(slices.images.map(i => i.id)).toEqual(['u1', 's1', 'product-K-0', 'a1', 'p1']);
    expect(slices.images[0]).not.toHaveProperty('file');
    expect(allImagesOf(lists, derivedOf(lists, env({ info }))).map(i => i.id)).toEqual(['u1', 's1', 'product-K-0', 'a1', 'p1']);
  });

  it('recuentos: «Media» no cuenta las de IA y la galería no cuenta procesadas ni IA', () => {
    const snapshot = buildSnapshot({ images: [upload, scraped], processedImages: [processed], aiImages: [ai] }, env(), ['u1', 'gone']);
    expect(headTotal(snapshot)).toBe(3);
    expect(galleryTotal(snapshot)).toBe(2);
    expect(snapshot.selection).toEqual(['u1']);
  });

  it('productInfoOf usa el SKU si el producto no tiene id', () => {
    expect(productInfoOf(null, 'K')).toBeNull();
    expect(productInfoOf({ sku: 'K', name: 'K', image: '', asin: '' }, 'K')).toEqual({ id: 'K', images: [], asin: null, source: undefined, image: null });
  });
});
