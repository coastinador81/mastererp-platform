import { bypass, http } from 'msw';
import { MARKETPLACE } from '@/shared/api/config';
import { collection } from '@/shared/mocks/db';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { IMAGES_ENDPOINTS } from '../api/endpoints';
import { AI_POOL, CATALOG_VARIANTS, hashOf, rotate, SCRAPE_POOL, slugOf } from './fixtures/images';

/**
 * Simulación del backend de la pestaña «Imágenes» (contrato en api/endpoints.ts).
 * Éxito por defecto con imágenes reales de /assets y latencias que dejan ver el
 * progreso del scraping (el cliente lo simula hasta el 90 %) y el «Generando...».
 * Scrapes y generaciones se guardan con @/shared/mocks/db, como los registraría el backend.
 */

// En las pruebas no se espera: la latencia solo sirve para ver los estados en el navegador.
const wait = (ms: number) => latency(import.meta.env.MODE === 'test' ? 0 : ms);

interface ScrapeRecord {
  id: string;
  url: string;
  product_id: string | null;
  images: string[];
  createdAt: string;
}

interface GenerationRecord {
  id: string;
  product_id: string | null;
  product_name: string;
  prompt: string;
  images: string[];
  createdAt: string;
}

const scrapes = collection<ScrapeRecord>('imagenes-scrapes');
const generations = collection<GenerationRecord>('imagenes-generaciones');

const originOf = (request: Request) => new URL(request.url).origin;
const stamp = () => Date.now().toString(36);

interface ScrapeBody {
  url?: unknown;
  product_id?: unknown;
}

interface GenerateBody {
  product_name?: unknown;
  product_id?: unknown;
  prompt?: unknown;
  num_images?: unknown;
  dimensions?: { width?: unknown; height?: unknown };
  style_config?: { style?: unknown } & Record<string, unknown>;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export const handlers = [
  // Scraper: 4-6 imágenes del producto según la URL (la misma URL da las mismas).
  http.post(mock(IMAGES_ENDPOINTS.IMAGE_SCRAPER), async ({ request }) => {
    const body = await readJson<ScrapeBody>(request);
    const raw = typeof body.url === 'string' ? body.url.trim() : '';
    await wait(2600);
    if (!raw) return fail(400, 'Indica la URL del producto.', 'invalid_url');
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const hash = hashOf(url);
    const origin = originOf(request);
    const images = rotate(SCRAPE_POOL, hash % SCRAPE_POOL.length, 4 + (hash % 3)).map(asset => `${origin}${asset.path}`);
    const productId = typeof body.product_id === 'string' ? body.product_id : null;
    scrapes.upsert({ id: `scrape-${stamp()}`, url, product_id: productId, images, createdAt: new Date().toISOString() });
    return HttpResponse.json({ success: true, url, product_id: productId, images, total: images.length });
  }),

  // Generador de Uony: `num_images` escenas del producto con el estilo pedido.
  http.post(mock(IMAGES_ENDPOINTS.AI_IMAGE_GENERATOR), async ({ request }) => {
    const body = await readJson<GenerateBody>(request);
    await wait(3400);
    const productName = typeof body.product_name === 'string' && body.product_name.trim() ? body.product_name.trim() : 'Producto';
    const requested = Number(body.num_images);
    const count = Number.isFinite(requested) ? Math.min(Math.max(Math.round(requested), 1), 6) : 3;
    const style = typeof body.style_config?.style === 'string' ? body.style_config.style : 'professional';
    const width = Number(body.dimensions?.width) || 1500;
    const height = Number(body.dimensions?.height) || 1500;
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    const productId = typeof body.product_id === 'string' ? body.product_id : null;
    const batch = stamp();
    const origin = originOf(request);
    // Cada generación empieza donde acabó la anterior: no repite las mismas escenas.
    const start = generations.all().reduce((total, record) => total + record.images.length, 0);
    const images = rotate(AI_POOL, start % AI_POOL.length, count).map((asset, index) => ({
      id: `ai-${batch}-${index}`,
      url: `${origin}${asset.path}`,
      name: `${slugOf(productName)}-ia-${index + 1}.jpg`,
      size: asset.size,
      type: asset.type,
      style,
      prompt,
      dimensions: { width, height },
      styleConfig: body.style_config ?? null,
    }));
    generations.upsert({
      id: `generation-${batch}`,
      product_id: productId,
      product_name: productName,
      prompt,
      images: images.map(image => image.url),
      createdAt: new Date().toISOString(),
    });
    return HttpResponse.json({ success: true, images, total: images.length, prompt });
  }),

  // Catálogo de Amazon: la galería del ASIN (MAIN + PT01…).
  http.get(mock(IMAGES_ENDPOINTS.AMAZON_CATALOG_IMAGES), async ({ params, request }) => {
    await wait(500);
    const asin = String(params.asin ?? '');
    const origin = originOf(request);
    const images = rotate(CATALOG_VARIANTS, 0, 3 + (hashOf(asin) % 4)).map(({ variant, path, width, height }) => ({
      variant,
      link: `${origin}${path}`,
      height,
      width,
    }));
    return HttpResponse.json({ asin, marketplace_id: MARKETPLACE.id, images, total_images: images.length });
  }),

  // Proxy de imágenes: sirve la imagen pedida en ?url=. Sin ?url= (A+ usa
  // uploadDestinationId) se deja pasar al siguiente handler.
  http.get(mock(IMAGES_ENDPOINTS.IMAGE_PROXY), async ({ request }) => {
    const target = new URL(request.url).searchParams.get('url');
    if (!target) return undefined;
    await wait(150);
    try {
      const response = await fetch(bypass(target));
      if (!response.ok) return fail(502, 'No se ha podido descargar la imagen.', 'image_unavailable');
      return new HttpResponse(await response.arrayBuffer(), {
        headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'image/jpeg', 'Cache-Control': 'private, max-age=300' },
      });
    } catch {
      return fail(502, 'No se ha podido descargar la imagen.', 'image_unavailable');
    }
  }),
];
