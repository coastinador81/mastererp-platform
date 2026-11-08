import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pimStore } from '@/shared/pim';
import { handlers } from '../mocks/handlers';
import { renderTab, resetAll, sampleProduct, SKU, upload } from './renderTab';

// El lienzo no existe en jsdom: el redimensionado se sustituye por un resultado fijo.
vi.mock('../actions/canvas', () => ({
  resizeForAmazon: vi.fn(async (url: string) => {
    if (url.includes('rota')) throw new Error('No se pudo cargar');
    return { blob: new Blob(['jpeg'], { type: 'image/jpeg' }), dimensions: { width: 1500, height: 1500 }, originalDimensions: { width: 1934, height: 1266 } };
  }),
}));

const server = setupServer(...handlers);
let blobs = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  resetAll();
  blobs = 0;
  URL.createObjectURL = vi.fn(() => `blob:http://localhost:3000/${++blobs}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Extraer Imágenes desde URL', () => {
  it('enseña el progreso, añade las scrapeadas y las recuerda para el producto', async () => {
    const user = userEvent.setup();
    renderTab();
    const scraper = screen.getByRole('region', { name: 'Extraer Imágenes desde URL' });
    await user.type(within(scraper).getByLabelText('URL del Producto'), 'https://tienda.test/make-it-possible');
    await user.click(within(scraper).getByRole('button', { name: 'Extraer Imágenes desde URL' }));
    expect(within(scraper).getByRole('progressbar', { name: 'Extrayendo imágenes...' })).toBeInTheDocument();
    expect(within(scraper).getByRole('status')).toHaveTextContent('Extrayendo imágenes...');
    expect(within(scraper).getByLabelText('URL del Producto')).toBeDisabled();
    const done = await screen.findByText(/^✅ \d imágenes extraídas$/);
    const total = Number(done.textContent?.match(/\d/)?.[0]);
    expect(screen.getByRole('heading', { name: `Galería de Imágenes (${total})` })).toBeInTheDocument();
    expect(screen.getByText('scraped-1.jpg')).toBeInTheDocument();
    expect(screen.getAllByText('Scrapeada')).toHaveLength(total);
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
    const saved = JSON.parse(localStorage.getItem(`scraped_images_${SKU}`) ?? '[]') as Array<{ url: string }>;
    expect(saved).toHaveLength(total);
    expect(saved[0].url).toMatch(/^\/api\/amazon\/aplus\/image-proxy\?url=/);
  });

  it('un error del servicio se avisa y el progreso se retira', async () => {
    server.use(http.post('/api/image-scraper', () => HttpResponse.json({ error: 'blocked', message: 'La página no permite extraer imágenes.' }, { status: 422 })));
    const user = userEvent.setup();
    renderTab();
    await user.type(screen.getByLabelText('URL del Producto'), 'https://tienda.test/x');
    await user.click(screen.getByRole('button', { name: 'Extraer Imágenes desde URL' }));
    expect(await screen.findByText('❌ Error: La página no permite extraer imágenes.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });

  it('sin producto guardado pide seleccionar uno (también para generar)', async () => {
    const user = userEvent.setup();
    renderTab('__new__', null);
    await user.type(screen.getByLabelText('URL del Producto'), 'https://tienda.test/x');
    await user.click(screen.getByRole('button', { name: 'Extraer Imágenes desde URL' }));
    await user.click(screen.getByRole('button', { name: 'Generar Imágenes' }));
    expect(await screen.findAllByText('Selecciona un producto primero')).toHaveLength(2);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('Generar Imágenes (Uony)', () => {
  it('genera tres imágenes con el estilo predeterminado', async () => {
    const user = userEvent.setup();
    renderTab();
    const button = screen.getByRole('button', { name: 'Generar Imágenes' });
    await user.click(button);
    expect(await screen.findByText('🎨 3 imágenes generadas con estilo Profesional')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Imágenes IA Generadas (3)' })).toBeInTheDocument();
    expect(screen.getAllByText('professional')).toHaveLength(3);
    expect(screen.getByText('make-it-possible-by-uonify-ia-1.jpg')).toBeInTheDocument();
    expect(button).toHaveTextContent('Generar Imágenes');
    expect(button).toBeEnabled();
    expect(pimStore.get<unknown[]>(SKU, 'aiImages')).toHaveLength(3);
    // «Media» no cuenta las de IA (totalImages del original).
    expect(screen.getByText('0 imágenes')).toBeInTheDocument();
  });

  it('mientras genera, el botón dice «Generando...» y está ocupado', async () => {
    let release: () => void = () => {};
    server.use(http.post('/api/ai-image-generator', async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return HttpResponse.json({ success: true, images: [] });
    }));
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole('button', { name: 'Generar Imágenes' }));
    const busy = await screen.findByRole('button', { name: 'Generando...' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    release();
    expect(await screen.findByText('❌ Error: No se generaron imágenes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar Imágenes' })).toBeEnabled();
  });
});

describe('Redimensionar', () => {
  it('crea las procesadas a 1500 px, avisa de las que fallan y limpia la selección', async () => {
    const user = userEvent.setup();
    pimStore.set(SKU, 'images', [upload('u1', 'UON-KIT-01.PT01.jpg'), upload('u2', 'rota.jpg')]);
    renderTab();
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    await user.click(screen.getByRole('button', { name: 'Redimensionar' }));
    expect(await screen.findByText('✅ 1 imagen redimensionada a 1500px')).toBeInTheDocument();
    expect(screen.getByText('❌ 1 imagen falló')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Imágenes Procesadas (1)' })).toBeInTheDocument();
    expect(screen.getByText('Processed UON-KIT-01.PT01.jpg')).toBeInTheDocument();
    expect(screen.getByText('1500 × 1500px')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar UON-KIT-01.PT01.jpg' })).not.toBeChecked();
    const processed = pimStore.get<Array<{ url: string; status: string; originalDimensions: unknown }>>(SKU, 'processedImages');
    expect(processed[0]).toMatchObject({ url: 'blob:http://localhost:3000/1', status: 'processed', originalDimensions: { width: 1934, height: 1266 } });
  });
});

describe('catálogo de Amazon y descargas', () => {
  it('un producto de Amazon con ASIN trae su galería del catálogo', async () => {
    renderTab(SKU, sampleProduct({ source: 'amazon', asin: 'B0UONIFY01', images: [] }));
    expect(await screen.findByText('Amazon MAIN Image')).toBeInTheDocument();
    expect(screen.getAllByText('Amazon').length).toBeGreaterThanOrEqual(3);
    expect(pimStore.get<Array<{ id: string }>>(SKU, 'images')[0].id).toBe(`amazon-catalog-${SKU}-0`);
  });

  it('«Favorito» y «Descargar» guardan la imagen (las externas por el image-proxy)', async () => {
    const proxied: string[] = [];
    server.use(http.get('/api/amazon/aplus/image-proxy', ({ request }) => {
      proxied.push(new URL(request.url).searchParams.get('url') ?? '');
      return new HttpResponse(new Blob(['jpeg'], { type: 'image/jpeg' }), { headers: { 'Content-Type': 'image/jpeg' } });
    }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    pimStore.set(SKU, 'aiImages', [upload('a1', 'escena.jpg', { url: 'https://cdn.uonify.test/escena.jpg', source: 'ai-generated', status: 'generated' })]);
    renderTab();
    await user.click(screen.getByRole('button', { name: 'Favorito' }));
    expect(await screen.findByText('📥 escena.jpg descargada')).toBeInTheDocument();
    expect(proxied).toEqual(['https://cdn.uonify.test/escena.jpg']);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
