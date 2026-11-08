import { setupServer } from 'msw/node';
import { api, ApiError } from '@/shared/api/client';
import { handlers } from '@/shared/mocks/handlers';

/**
 * Contrato de la simulación completa: todas las rutas de los módulos juntas.
 * Una misma ruta y método en dos módulos solo se admite si la comparten a
 * propósito (y el primero deja pasar lo que no es suyo).
 */
const SHARED_ROUTES = new Set(['GET /api/amazon/aplus/image-proxy']);

const routeOf = (handler: (typeof handlers)[number]) => {
  const info = handler.info as { method?: unknown; path?: unknown };
  return `${String(info.method)} ${String(info.path)}`;
};

test('ninguna ruta de la API está simulada dos veces sin querer', () => {
  const seen = new Map<string, number>();
  handlers.forEach(handler => seen.set(routeOf(handler), (seen.get(routeOf(handler)) ?? 0) + 1));
  const duplicated = [...seen].filter(([route, count]) => count > 1 && !SHARED_ROUTES.has(route)).map(([route]) => route);
  expect(duplicated).toEqual([]);
});

describe('image-proxy compartido por A+ (uploadDestinationId) e Imágenes (url)', () => {
  const server = setupServer(...handlers);
  const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
  const imageUrl = 'https://tienda.test/foto.jpg';
  const original = globalThis.fetch;

  beforeAll(() => {
    // La web externa: el proxy de Imágenes la descarga saltándose MSW (bypass), así
    // que se sustituye la red antes de que MSW envuelva fetch.
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === imageUrl) return Promise.resolve(new Response(IMAGE.slice(), { headers: { 'Content-Type': 'image/jpeg' } }));
      return original(input, init);
    }) as typeof fetch;
    server.listen({ onUnhandledRequest: 'bypass' });
  });
  afterAll(() => {
    server.close();
    globalThis.fetch = original;
  });

  test('?url= llega al proxy de Imágenes y devuelve la imagen', async () => {
    const blob = await api.get<Blob>('/amazon/aplus/image-proxy', { params: { url: imageUrl }, responseType: 'blob' });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(IMAGE);
  });

  test('?uploadDestinationId= sigue siendo de A+', async () => {
    const error = await api.get('/amazon/aplus/image-proxy', { params: { uploadDestinationId: 'no-existe' } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, data: { error: 'IMAGE_NOT_ACCESSIBLE' } });
  });
});
