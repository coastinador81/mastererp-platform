import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { toast } from '@/shared/ui';
import { handlers } from '../mocks/handlers';

/**
 * Servidor MSW para las pruebas con las simulaciones del módulo. En Node, fetch
 * no resuelve rutas relativas («/api/…»): se resuelven contra la página de jsdom.
 * Las imágenes de /assets devuelven unos bytes JPEG mínimos.
 */
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

export function setupAplusServer() {
  const server = setupServer(...handlers);
  let original: typeof fetch;
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' });
    original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string' && input.startsWith('/assets/')) return Promise.resolve(new Response(JPEG_BYTES.slice(), { status: 200 }));
      const url = typeof input === 'string' && input.startsWith('/') ? new URL(input, window.location.href).href : input;
      return original(url, init);
    }) as typeof fetch;
  });
  afterEach(() => {
    server.resetHandlers();
    toast.dismiss();
  });
  afterAll(() => {
    globalThis.fetch = original;
    server.close();
  });
  return server;
}
