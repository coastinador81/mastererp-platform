import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, type RequestHandler } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { appRoutes } from '@/app/appRoutes';
import { AppProviders } from '@/app/providers/AppProviders';
import { API_BASE } from '@/shared/api/config';
import { queryClient } from '@/shared/api/queryClient';
import { handlers } from '@/shared/mocks/handlers';
import { toast } from '@/shared/ui';

/**
 * Pruebas de humo de la aplicación completa: el árbol de rutas real (appRoutes),
 * los proveedores reales y TODAS las simulaciones MSW de los módulos. Solo
 * comprueban que cada ruta se pinta sin errores; el comportamiento fino lo
 * prueban los módulos.
 */

// Las pruebas de rutas verifican contratos y montaje; no necesitan la espera visual del prototipo.
vi.mock('@/shared/mocks/utils', async original => ({
  ...await original<typeof import('@/shared/mocks/utils')>(), latency: () => Promise.resolve(),
}));

// Imágenes, vídeos y modelos de /assets: bytes mínimos (en Node no hay servidor de estáticos).
const staticAssets: RequestHandler = http.get(/\/assets\//, () => new HttpResponse(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
  headers: { 'Content-Type': 'application/octet-stream' },
}));

/** Rutas de la API pedidas sin simulación: cada una es un hueco del contrato. */
export const unhandledApiCalls: string[] = [];

export const server = setupServer(...handlers, staticAssets);

// Peticiones en curso (para esperar a que la simulación responda antes de comprobar).
// Una petición cancelada (cambio de ruta, desmontaje) no llega a «request:end».
const pendingRequests = new Set<string>();
server.events.on('request:start', ({ request, requestId }) => {
  pendingRequests.add(requestId);
  request.signal.addEventListener('abort', () => pendingRequests.delete(requestId));
});
server.events.on('request:end', ({ requestId }) => { pendingRequests.delete(requestId); });

export function setupSmokeServer(): void {
  beforeAll(() => {
    // jsdom no implementa el desplazamiento de la ventana.
    window.scrollTo = (() => {}) as typeof window.scrollTo;
    server.listen({
      onUnhandledRequest(request) {
        const url = new URL(request.url);
        if (url.pathname.startsWith(API_BASE)) unhandledApiCalls.push(`${request.method} ${url.pathname}`);
      },
    });
  });
  afterEach(async () => {
    cleanup();
    // Se espera a las peticiones en curso antes de vaciar la caché (vaciarla las cancela).
    await waitFor(() => expect(queryClient.isFetching() + queryClient.isMutating()).toBe(0), { timeout: 5000 });
    queryClient.clear();
    pendingRequests.clear();
    toast.dismiss();
    server.resetHandlers();
  });
  afterAll(() => server.close());
}

const SMOKE_EMAIL = 'ana@uonify.test';

/**
 * Sesión simulada lista (alta completa y mayor de edad), escrita donde la guarda
 * la «base de datos» de MSW (@/shared/mocks/db → sessionStorage «uonify-mock:*»).
 * Debe llamarse antes de la primera petición de la sesión en el archivo.
 */
export function seedSignedInSession(): void {
  sessionStorage.setItem('uonify-mock:auth-session', JSON.stringify({ email: SMOKE_EMAIL, provider: 'chatgpt', startedAt: new Date().toISOString() }));
  sessionStorage.setItem('uonify-mock:auth-consents', JSON.stringify([{ id: SMOKE_EMAIL, consents: ['terms', 'privacy', 'ai-third-party'].map(id => ({ id, version: id === 'ai-third-party' ? '2026-09-26' : '2026-09-27', acceptedAt: new Date().toISOString() })) }]));
  sessionStorage.setItem('uonify-mock:auth-profiles', JSON.stringify([{
    id: SMOKE_EMAIL,
    savedAt: new Date().toISOString(),
    profile: {
      firstName: 'Ana',
      lastName: 'García',
      name: 'Ana García',
      email: SMOKE_EMAIL,
      ageRange: '25-34',
      role: 'brand',
      companySize: '11-50',
      company: 'Uonify',
      primaryGoal: 'catalog',
      source: '',
      desiredPlan: 'free',
    },
  }]));
}

/** Errores de la consola durante la prueba (React y el router los registran ahí). */
export function collectConsoleErrors(): string[] {
  const errors: string[] = [];
  beforeEach(() => {
    errors.length = 0;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(arg => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg))).join(' '));
    });
  });
  afterEach(() => vi.restoreAllMocks());
  return errors;
}

/** Pinta la aplicación completa en `path` con un router de memoria. */
export function renderApp(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router };
}

/** Una ruta lazy se comprueba después de que el router termine de importar su pantalla. */
export async function awaitRouterReady(router: ReturnType<typeof createMemoryRouter>): Promise<void> {
  await act(async () => {
    if (router.state.initialized) return;
    await new Promise<void>(resolve => {
      const unsubscribe = router.subscribe(state => {
        if (state.initialized) { unsubscribe(); resolve(); }
      });
    });
  });
  // Un import fallido sigue siendo un fallo de la prueba, nunca una pantalla lista.
  expect(router.state.errors).toBeNull();
}

/** Espera a que la simulación haya respondido a todo lo que la vista pidió al montarse. */
export async function settle(): Promise<void> {
  await waitFor(() => expect(pendingRequests.size + queryClient.isFetching()).toBe(0), { timeout: 4000 });
}

/** Ni la pantalla de error del router, ni el aviso de una pestaña rota, ni avisos de error. */
export function expectNoCrashScreen(): void {
  expect(screen.queryByText(/Unexpected Application Error/i)).not.toBeInTheDocument();
  expect(screen.queryByText('No se ha podido abrir esta pestaña')).not.toBeInTheDocument();
  expect(Array.from(document.querySelectorAll('.pim-toast-error'), node => node.textContent)).toEqual([]);
}
