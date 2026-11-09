import { screen, waitFor } from '@testing-library/react';
import { collectConsoleErrors, expectNoCrashScreen, renderApp, settle, setupSmokeServer, unhandledApiCalls } from './harness';

// jsdom no tiene WebGL: <model-viewer> (Novedades, Productos) se queda sin definir, como antes de cargar.
vi.mock('@google/model-viewer', () => ({}));

setupSmokeServer();
const consoleErrors = collectConsoleErrors();

// Ruta, título principal (h1) y título del documento de cada vista pública.
const PUBLIC_ROUTES: Array<[path: string, heading: RegExp, title: RegExp]> = [
  ['/', /^Hazlo ?posible\.$/, /^Uonify — Hazlo posible$/],
  ['/productos', /^Tus productos\./, /^Servicios — Uonify$/],
  ['/como-funciona', /^Dilo como lo piensas\./, /^Cómo funciona Uonify/],
  ['/lo-que-puedes-hacer', /^Siempre se puede empezar/, /^Lo que puedes hacer con Uonify$/],
  ['/precios', /^Un plan\./, /^Precios — Uonify$/],
  ['/seguridad', /^Tus cuentas son tu negocio\./, /^Seguridad — Uonify$/],
  ['/para-empresas', /^Varias marcas, varios canales\./, /^Para equipos y marcas/],
  ['/sobre-uonify', /^Detrás de cada producto/, /^Sobre Uonify/],
  ['/novedades', /^Nuevas piezas\./, /^Novedades/],
  ['/privacidad', /^Tu información, bajo tu control\.$/, /^Privacidad — Uonify$/],
  ['/terminos', /^Términos y condiciones$/, /^Términos y condiciones — Uonify$/],
];

describe('web pública (sin sesión)', () => {
  test.each(PUBLIC_ROUTES)('%s se pinta sin errores', async (path, heading, title) => {
    const { router } = renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 5000 })).toBeInTheDocument();
    expect(document.title).toMatch(title);
    expect(router.state.location.pathname).toBe(path);
    await settle();
    expectNoCrashScreen();
    expect(consoleErrors).toEqual([]);
    expect(unhandledApiCalls).toEqual([]);
  });

  test('una URL del prototipo redirige a su ruta', async () => {
    const { router } = renderApp('/index.html?view=empresa');
    await waitFor(() => expect(router.state.location.pathname).toBe('/sobre-uonify'));
    expect(await screen.findByRole('heading', { level: 1, name: /^Detrás de cada producto/ })).toBeInTheDocument();
  });

  test('una ruta desconocida vuelve a la portada', async () => {
    const { router } = renderApp('/no-existe');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { level: 1, name: /^Hazlo ?posible\.$/ })).toBeInTheDocument();
    expectNoCrashScreen();
  });

  test('el espacio sin sesión vuelve a la portada', async () => {
    const { router } = renderApp('/espacio');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'), { timeout: 5000 });
    expectNoCrashScreen();
  });
});
