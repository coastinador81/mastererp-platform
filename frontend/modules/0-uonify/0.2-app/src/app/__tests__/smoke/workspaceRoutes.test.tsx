import { screen, waitFor } from '@testing-library/react';
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

describe('espacio de trabajo (sesión lista)', () => {
  test.each(WORKSPACE_ROUTES)('%s se pinta sin errores', async (path, heading) => {
    const { router } = renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir servicios de Uonify' })).toBeInTheDocument();
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
    expect(router.state.location.pathname).toBe(path);
    await settle();
    expectNoCrashScreen();
    expect(consoleErrors).toEqual([]);
    expect(unhandledApiCalls).toEqual([]);
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
