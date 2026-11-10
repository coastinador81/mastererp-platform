import { cleanup, screen, waitFor } from '@testing-library/react';
import {
  collectConsoleErrors,
  expectNoCrashScreen,
  renderApp,
  settle,
  seedSignedInSession,
  setupSmokeServer,
  unhandledApiCalls,
} from './harness';

setupSmokeServer();
const consoleErrors = collectConsoleErrors();
seedSignedInSession();

// Ruta del espacio y título principal (h1) de su vista.
const WORKSPACE_ROUTES: Array<[path: string, heading: RegExp]> = [
  ['/espacio', /^Hazlo ?posible\.$/],
  ['/espacio/analitica', /^Analítica$/],
  ['/espacio/auditoria', /^Captura y auditoría$/],
  ['/espacio/academy', /^Academy$/],
  ['/espacio/logistica', /^Logística$/],
  ['/espacio/fabrica', /^Fábrica y proveedores$/],
  ['/espacio/nexus', /^Nexus$/],
  ['/espacio/nexus/amazon', /^Nexus$/],
  ['/espacio/nexus/shopify', /^Nexus$/],
];

/** El pie global, una sola vez, cierra el espacio: fuera de la vista y de la conversación. */
function expectGlobalFooter(): HTMLElement {
  const footers = document.querySelectorAll<HTMLElement>('footer.site-footer');
  expect(footers).toHaveLength(1);
  expect(footers[0].parentElement).toHaveClass('workspace-footer');
  expect(screen.getByRole('main', { name: 'Espacio de trabajo' })).not.toContainElement(footers[0]);
  return footers[0];
}

/** Marcado del pie (sin espacios entre etiquetas), para compararlo entre páginas. */
const footerMarkup = (footer: HTMLElement) => footer.outerHTML.replace(/>\s+</g, '><').trim();

describe('espacio de trabajo (sesión lista)', () => {
  test.each(WORKSPACE_ROUTES)('%s se pinta sin errores', async (path, heading) => {
    const { router } = renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir servicios de Uonify' })).toBeInTheDocument();
    expectGlobalFooter();
    expect(router.state.location.pathname).toBe(path);
    await settle();
    expectNoCrashScreen();
    expect(consoleErrors).toEqual([]);
    expect(unhandledApiCalls).toEqual([]);
  });

  // ERP · Finanzas tiene la mesa de Producto: menú o lista a la izquierda y conversación, o la ficha.
  test.each([
    ['/espacio/erp', () => screen.findByRole('complementary', { name: 'Menú de Finanzas' }, { timeout: 4000 })],
    ['/espacio/erp/solicitudes-compra', () => screen.findByRole('complementary', { name: 'Compras' }, { timeout: 4000 })],
    ['/espacio/erp/solicitudes-compra/DEMO-COM-001', () => screen.findByRole('heading', { level: 1, name: 'DEMO-COM-001' }, { timeout: 4000 })],
    // Agentes tiene la misma mesa (10-11-2026): menú a la izquierda y conversación.
    ['/espacio/agentes', () => screen.findByRole('complementary', { name: 'Menú de Agentes' }, { timeout: 4000 })],
  ])('%s se pinta sin errores', async (path, find) => {
    const { router } = renderApp(path);
    expect(await find()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir servicios de Uonify' })).toBeInTheDocument();
    expectGlobalFooter();
    expect(router.state.location.pathname).toBe(path);
    await settle();
    expectNoCrashScreen();
    expect(consoleErrors).toEqual([]);
    expect(unhandledApiCalls).toEqual([]);
  });

  test('el pie de ERP y el del lienzo son el mismo que el de la web pública (/terminos con sesión)', async () => {
    renderApp('/espacio/erp');
    await screen.findByRole('complementary', { name: 'Menú de Finanzas' }, { timeout: 4000 });
    const erp = footerMarkup(expectGlobalFooter());
    await settle();
    cleanup();
    renderApp('/espacio');
    await screen.findByRole('heading', { level: 1, name: /^Hazlo ?posible\.$/ }, { timeout: 4000 });
    expect(footerMarkup(expectGlobalFooter())).toBe(erp);
    await settle();
    cleanup();
    renderApp('/terminos');
    await waitFor(() => expect(document.querySelector('footer.site-footer')).not.toBeNull(), { timeout: 5000 });
    expect(footerMarkup(document.querySelector('footer.site-footer') as HTMLElement)).toBe(erp);
    expect(erp).toContain('Términos y condiciones');
    await settle();
  });

  test('el pie no se oculta mientras la puerta comprueba el acceso («Preparando tu espacio…»)', async () => {
    renderApp('/espacio');
    expect(await screen.findByText('Preparando tu espacio…', {}, { timeout: 4000 })).toBeInTheDocument();
    const waiting = document.querySelectorAll<HTMLElement>('footer.site-footer');
    expect(waiting).toHaveLength(1);
    const markup = footerMarkup(waiting[0]);
    // Al abrirse el espacio, su pie (en la columna) es el mismo.
    await screen.findByRole('heading', { level: 1, name: /^Hazlo ?posible\.$/ }, { timeout: 4000 });
    expect(footerMarkup(expectGlobalFooter())).toBe(markup);
    await settle();
  });

  test('el enlace ?service= de la web pública abre ese servicio', async () => {
    const { router } = renderApp('/espacio?service=erp');
    await waitFor(() => expect(router.state.location.pathname).toBe('/espacio/erp'));
    expect(await screen.findByRole('complementary', { name: 'Menú de Finanzas' })).toBeInTheDocument();
  });

  test('una dirección desconocida del espacio vuelve al lienzo', async () => {
    const { router } = renderApp('/espacio/no-existe');
    await waitFor(() => expect(router.state.location.pathname).toBe('/espacio'));
    expect(await screen.findByRole('heading', { level: 1, name: /^Hazlo ?posible\.$/ })).toBeInTheDocument();
  });

  test('la portada con la sesión lista lleva al espacio', async () => {
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/espacio'), { timeout: 4000 });
    expect(await screen.findByRole('button', { name: 'Abrir servicios de Uonify' }, { timeout: 4000 })).toBeInTheDocument();
    await settle();
    expectNoCrashScreen();
  });

  test('el modelo y el esfuerzo elegidos en la portada siguen al entrar en el espacio', async () => {
    // La portada los guarda en sessionStorage; se llega al espacio sin recargar la página.
    sessionStorage.setItem('uonify-composer-preferences', JSON.stringify({ model: 'gpt-6-sol', effort: 'high', speed: 'fast' }));
    renderApp('/espacio');
    expect(await screen.findByRole('button', { name: 'Modelo: GPT-6 Sol. Elegir otro modelo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esfuerzo: Alto. Ajustar esfuerzo de razonamiento' })).toBeInTheDocument();
    sessionStorage.removeItem('uonify-composer-preferences');
    await settle();
  });

  test('Privacidad y Condiciones siguen abiertas con sesión', async () => {
    const { router } = renderApp('/privacidad');
    expect(await screen.findByRole('heading', { level: 1, name: /^Tu información, bajo tu control\.$/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/privacidad');
  });
});
