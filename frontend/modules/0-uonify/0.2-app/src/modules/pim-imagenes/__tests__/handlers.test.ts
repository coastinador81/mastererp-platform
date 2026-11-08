import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearCatalogImagesCache, generateImages, getCatalogImages, scrapeImagesFromUrl } from '../api/imagesApi';
import { DEFAULT_STYLE } from '../model/labels';
import { handlers } from '../mocks/handlers';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  clearCatalogImagesCache();
});
afterAll(() => server.close());

describe('simulación del backend de «Imágenes»', () => {
  it('scraper: imágenes reales del producto, envueltas en el image-proxy, con su total', async () => {
    const result = await scrapeImagesFromUrl('https://tienda.test/producto', 'UON-KIT-01');
    expect(result.total).toBe(result.images?.length);
    expect(result.images!.length).toBeGreaterThanOrEqual(4);
    expect(result.images!.length).toBeLessThanOrEqual(6);
    result.images!.forEach(url => {
      expect(url).toMatch(/^\/api\/amazon\/aplus\/image-proxy\?url=http%3A%2F%2Flocalhost/);
      expect(decodeURIComponent(url)).toMatch(/\/assets\//);
    });
    // La misma URL da las mismas imágenes.
    const again = await scrapeImagesFromUrl('https://tienda.test/producto', 'UON-KIT-01');
    expect(again.images).toEqual(result.images);
  });

  it('scraper: sin URL responde con el error del backend', async () => {
    await expect(scrapeImagesFromUrl('  ', 'UON-KIT-01')).rejects.toThrow('Indica la URL del producto.');
  });

  it('generador de Uony: tres imágenes con el estilo, el prompt y las dimensiones pedidas', async () => {
    const result = await generateImages('Make It Possible by Uonify', { id: 'UON-KIT-01', brand: 'Uonify', category: 'Juguetes' }, DEFAULT_STYLE, 3);
    expect(result.success).toBe(true);
    expect(result.images).toHaveLength(3);
    result.images!.forEach((image, index) => {
      expect(image).toMatchObject({
        style: 'professional',
        dimensions: { width: 1500, height: 1500 },
        name: `make-it-possible-by-uonify-ia-${index + 1}.jpg`,
      });
      expect(image.url).toMatch(/^http:\/\/localhost(:\d+)?\/assets\//);
      expect(image.prompt).toMatch(/^Uonify Make It Possible by Uonify, fotografía profesional/);
    });
    const next = await generateImages('Make It Possible by Uonify', {}, DEFAULT_STYLE, 3);
    expect(next.images![0].url).not.toBe(result.images![0].url);
  });

  it('catálogo de Amazon: variantes MAIN, PT01… con medidas', async () => {
    const data = await getCatalogImages('B0UONIFY01');
    expect(data.asin).toBe('B0UONIFY01');
    expect(data.images![0]).toMatchObject({ variant: 'MAIN', width: 2000, height: 2000 });
    expect(data.total_images).toBe(data.images!.length);
    expect(data.images!.length).toBeGreaterThanOrEqual(3);
  });
});
