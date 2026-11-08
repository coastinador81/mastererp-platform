import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import type { AmazonState } from '../api/amazonApi';
import { AmazonConnectionSettings } from '../components/AmazonConnectionSettings';

const base = '/connections/amazon';
const flowId = 'b'.repeat(64);
const loginUri = 'https://oauth.example.test/integrations/amazon/login';
const launch = 'A'.repeat(64);
const authUrl = `${loginUri}?launch=${launch}`;
const account = 'owner@example.test';
function state(connected = false): AmazonState {
  return {
    connection: connected ? { status: 'connected', sellerId: 'SELLER-OWNED', marketplaceId: 'A1RKKUPIHCS9HS' } : { status: 'disconnected' },
    available: true, accessAllowed: true,
    setup: { httpsReady: true, applicationReady: true, credentialsReady: true, loginUri, redirectUri: 'https://oauth.example.test/integrations/amazon/callback' },
  };
}
function mount(props: { intentId?: string; onIntentHandled?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><AmazonConnectionSettings account={account} {...props} /></QueryClientProvider>);
}
function popup() {
  const child = { opener: window, document: { title: '', body: { textContent: '' } }, location: { replace: vi.fn() }, focus: vi.fn(), close: vi.fn(), closed: false };
  vi.mocked(window.open).mockReturnValue(child as unknown as Window);
  return child;
}
function intentState(expiresAt = new Date(Date.now() + 600_000).toISOString()) {
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === base) return state() as never;
    if (path === `${base}/intents/intent-test`) return { sellerId: 'SELLER-REQUESTED', expiresAt } as never;
    if (path === `${base}/flows/${flowId}`) return { status: 'pending' } as never;
    throw new Error(`Ruta inesperada: ${path}`);
  });
}
beforeEach(() => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  vi.spyOn(window, 'focus').mockImplementation(() => undefined);
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  vi.spyOn(api, 'delete').mockResolvedValue({ disconnected: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['available', 'httpsReady', 'applicationReady', 'credentialsReady'] as const)('no presenta conexión ni permite OAuth si falta %s', async missing => {
  const data = state();
  if (missing === 'available') data.available = false;
  else data.setup[missing] = false;
  vi.spyOn(api, 'get').mockResolvedValue(data);
  mount();
  await screen.findByText('Configuración pendiente');
  expect(screen.getByText('Sin conectar')).toBeInTheDocument();
  expect(screen.queryByText('Conectado')).not.toBeInTheDocument();
  const button = screen.queryByRole('button', { name: 'Conectar Amazon' });
  if (button) expect(button).toBeDisabled();
  expect(window.open).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});

it('bloquea conectar sin una prueba o suscripción vigente aunque Amazon esté configurado', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...state(), accessAllowed: false });
  mount();
  const connect = await screen.findByRole('button', { name: 'Conectar Amazon' });
  expect(connect).toBeDisabled();
  await userEvent.click(connect);
  expect(screen.getByText(/Necesitas una prueba o suscripción vigente/)).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
});

it('un fallo al recuperar la conexión no produce un estado conectado de respaldo', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, {}));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('No podemos comprobar Amazon.');
  expect(screen.queryByText('Conectado')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Conectar Amazon' })).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

it('muestra el vendedor solicitado y espera confirmación antes de aceptar el intento', async () => {
  intentState(); popup();
  const handled = vi.fn();
  mount({ intentId: 'intent-test', onIntentHandled: handled });
  expect(await screen.findByText('SELLER-REQUESTED')).toBeInTheDocument();
  expect(screen.getByText(account)).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
  expect(handled).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar y continuar en Amazon' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${base}/intents/intent-test/accept`, {}, expect.any(Object)));
  expect(handled).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Sin conectar')).toBeInTheDocument();
});

it('no consume el intento si el navegador bloquea la ventana', async () => {
  intentState(); const handled = vi.fn();
  mount({ intentId: 'intent-test', onIntentHandled: handled });
  await screen.findByText('SELLER-REQUESTED');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar y continuar en Amazon' }));
  expect(await screen.findByText(/ha bloqueado la ventana de Amazon/)).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  expect(handled).not.toHaveBeenCalled();
});

it('conserva el intento y muestra el rechazo si la aceptación falla', async () => {
  intentState(); popup(); const handled = vi.fn();
  vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'La solicitud ya no está disponible.' }));
  mount({ intentId: 'intent-test', onIntentHandled: handled });
  await screen.findByText('SELLER-REQUESTED');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar y continuar en Amazon' }));
  expect(await screen.findByText('La solicitud ya no está disponible.')).toBeInTheDocument();
  expect(handled).not.toHaveBeenCalled();
  expect(screen.getByText('Sin conectar')).toBeInTheDocument();
});

it('no acepta un intento caducado', async () => {
  intentState(new Date(Date.now() - 1000).toISOString());
  mount({ intentId: 'intent-test' });
  expect(await screen.findByRole('alert')).toHaveTextContent(/ha caducado/);
  expect(screen.getByRole('button', { name: 'Confirmar y continuar en Amazon' })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
});

it('cancelar la solicitud no acepta ni desconecta ninguna cuenta', async () => {
  intentState(); const handled = vi.fn();
  mount({ intentId: 'intent-test', onIntentHandled: handled });
  await screen.findByText('SELLER-REQUESTED');
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar solicitud' }));
  expect(handled).toHaveBeenCalledTimes(1);
  expect(api.post).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
});

it('no muestra conectado hasta recuperar la conexión persistida después del éxito OAuth', async () => {
  popup();
  let reads = 0;
  let finish!: (value: AmazonState) => void;
  const refreshed = new Promise<AmazonState>(resolve => { finish = resolve; });
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === base) return (++reads === 1 ? state() : refreshed) as never;
    if (path === `${base}/flows/${flowId}`) return { status: 'success' } as never;
    throw new Error(`Ruta inesperada: ${path}`);
  });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Conectar Amazon' }));
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByText('Sin conectar')).toBeInTheDocument();
  expect(screen.queryByText('Conectado')).not.toBeInTheDocument();
  await act(async () => { finish(state(true)); await refreshed; });
  expect(await screen.findByText('Conectado')).toBeInTheDocument();
  expect(screen.getByText('SELLER-OWNED')).toBeInTheDocument();
});

it('desconecta solo al confirmar y comprueba el nuevo estado en el servidor', async () => {
  let connected = true;
  const get = vi.spyOn(api, 'get').mockImplementation(async () => state(connected) as never);
  vi.mocked(api.delete).mockImplementation(async () => { connected = false; return { disconnected: true } as never; });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Desconectar Amazon' }));
  expect(api.delete).not.toHaveBeenCalled();
  expect(screen.getByText('Conectado')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Mantener conexión' }));
  expect(api.delete).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Desconectar Amazon' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar desconexión' }));
  expect(api.delete).toHaveBeenCalledTimes(1);
  expect(api.delete).toHaveBeenCalledWith(base);
  expect(await screen.findByRole('button', { name: 'Conectar Amazon' })).toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Sin conectar')).toBeInTheDocument();
  expect(screen.getByText(/Puedes retirar también la autorización desde Seller Central/)).toBeInTheDocument();
});

it('conserva la cuenta conectada cuando falla la desconexión', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(state(true));
  vi.mocked(api.delete).mockRejectedValue(new ApiError(503, { message: 'No se ha podido desconectar Amazon.' }));
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Desconectar Amazon' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar desconexión' }));
  expect(await screen.findByText('No se ha podido desconectar Amazon.')).toBeInTheDocument();
  expect(screen.getByText('Conectado')).toBeInTheDocument();
  expect(screen.getByText('SELLER-OWNED')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Conectar Amazon' })).not.toBeInTheDocument();
});
