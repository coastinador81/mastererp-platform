import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { mock } from '@/shared/mocks/utils';
import { DriveOnboarding } from '../components/DriveOnboarding';
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'owner@example.test' }));
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => server.close());
const base = '/connections/google-drive';
function mount(connected: boolean, onContinue = vi.fn(), deferred = false, onProgress = vi.fn()) {
  server.use(http.get(mock(base), () => HttpResponse.json({ connection: { status: connected ? 'connected' : 'disconnected', email: 'drive@example.test' }, available: true, accessAllowed: true, onboardingDeferred: deferred })));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DriveOnboarding account="owner@example.test" onContinue={onContinue} onProgress={onProgress} /></QueryClientProvider>);
  return onContinue;
}
it('solo muestra la conexión: no consulta archivos, materiales ni pide recursos al continuar', async () => {
  const fetchFiles = vi.fn();
  server.use(http.get(mock(base + '/files'), () => { fetchFiles(); return HttpResponse.json({ files: [] }); }), http.get(mock(base + '/materials'), () => { fetchFiles(); return HttpResponse.json({ files: [] }); }));
  const done = mount(true);
  await userEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
  expect(done).toHaveBeenCalledOnce(); expect(fetchFiles).not.toHaveBeenCalled();
  expect(screen.queryByPlaceholderText('Buscar un archivo o carpeta')).not.toBeInTheDocument();
  expect(screen.queryByText('Subir archivo a Drive')).not.toBeInTheDocument();
});
it('explica el beneficio de Drive y comunica su estado a la barra general sin analizar archivos', async () => {
  const progress = vi.fn();
  const done = mount(true, vi.fn(), false, progress);
  expect(await screen.findByText(/Elige documentos y fotos de tu Drive para que Uony prepare tus productos/)).toBeVisible();
  expect(progress).toHaveBeenLastCalledWith({ id: 'drive-ready', label: 'Drive preparado', index: 2, total: 2 });
  expect(done).not.toHaveBeenCalled();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
it('guarda la elección de conectar más adelante antes de salir', async () => {
  let saved = false;
  server.use(http.post(mock(base + '/defer'), () => { saved = true; return HttpResponse.json({ onboardingDeferred: true }); }));
  const done = mount(false, vi.fn(() => expect(saved).toBe(true)));
  await userEvent.click(await screen.findByRole('button', { name: 'Ahora no, más adelante' }));
  expect(done).toHaveBeenCalledOnce();
});
it('permite retomar la conexión aplazada y no sale si falla el guardado', async () => {
  server.use(http.post(mock(base + '/defer'), () => HttpResponse.json({ message: 'No se ha podido guardar' }, { status: 503 })));
  const done = mount(false, vi.fn(), true);
  await screen.findByText(/Has elegido conectarlo más adelante/);
  expect(screen.getByRole('button', { name: 'Conectar Google Drive' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Ahora no, más adelante' }));
  const error = await screen.findByRole('alert'); expect(done).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Sobre tus archivos y tu cuenta de Google' }));
  expect(error).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Ocultar: sobre tus archivos y tu cuenta de google' }));
  expect(error).toBeVisible();
  expect(screen.getByRole('button', { name: 'Ahora no, más adelante' })).toBeEnabled();
});
it('mantiene permisos y acciones visibles y permite consultar las aclaraciones sin avanzar ni perder la cuenta', async () => {
  const done = mount(false);
  expect(await screen.findByRole('button', { name: 'Conectar Google Drive' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Ahora no, más adelante' })).toBeVisible();
  expect(await screen.findByText(/Google te pedirá permiso para consultar tus archivos/)).toBeVisible();
  expect(screen.getByText('¿Todavía no tienes imágenes o documentos?')).not.toBeVisible();
  expect(screen.getByText('owner@example.test')).not.toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Sobre tus archivos y tu cuenta de Google' }));
  expect(screen.getByText('¿Todavía no tienes imágenes o documentos?')).toBeVisible();
  expect(screen.getByText('owner@example.test')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Ocultar: sobre tus archivos y tu cuenta de google' }));
  expect(done).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Conectar Google Drive' })).toBeEnabled();
});
it('conecta desde el paso compacto y conserva el resultado antes de continuar', async () => {
  const child = { opener: window, document: { title: '', body: { textContent: '' } }, location: { replace: vi.fn() }, focus: vi.fn(), close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window);
  vi.spyOn(window, 'focus').mockImplementation(() => {});
  let connected = false;
  const flowId = 'a'.repeat(64);
  server.use(
    http.post(mock(base + '/start'), async ({ request }) => { expect(await request.json()).toEqual({ popup: true }); return HttpResponse.json({ authUrl: 'https://accounts.google.com/o/oauth2/auth', flowId }); }),
    http.get(mock(base + '/flows/' + flowId), () => { connected = true; return HttpResponse.json({ status: 'success' }); }),
  );
  const done = mount(false);
  server.use(http.get(mock(base), () => HttpResponse.json({ connection: { status: connected ? 'connected' : 'disconnected', email: 'owner@example.test' }, available: true, preparationAllowed: true })));
  await userEvent.click(await screen.findByRole('button', { name: 'Conectar Google Drive' }));
  expect(await screen.findByText('Google Drive conectado', {}, { timeout: 2500 })).toBeVisible();
  expect(screen.getByText('owner@example.test', { selector: 'small' })).toBeVisible();
  expect(done).not.toHaveBeenCalled();
  expect(child.location.replace).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(done).toHaveBeenCalledOnce();
});
