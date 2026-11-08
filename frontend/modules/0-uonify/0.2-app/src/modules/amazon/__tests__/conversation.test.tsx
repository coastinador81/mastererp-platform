import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { AmazonConversationConnection } from '../components/AmazonConversationConnection';
import type { AmazonState } from '../api/amazonApi';

const base = '/connections/amazon';
const flowId = 'a'.repeat(64);
const loginUri = 'https://oauth.example.test/integrations/amazon/login';
const authUrl = `${loginUri}?launch=${'A'.repeat(64)}`;
const account = 'owner@example.test';
function connection(connected = false): AmazonState {
  return {
    connection: connected ? { status: 'connected', sellerId: 'SELLER-OWNER' } : { status: 'disconnected' },
    available: true, accessAllowed: true,
    setup: { httpsReady: true, applicationReady: true, credentialsReady: true, loginUri, redirectUri: 'https://oauth.example.test/integrations/amazon/callback' },
  };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = (email: string) => <QueryClientProvider client={client}><AmazonConversationConnection account={email} /></QueryClientProvider>;
  const result = render(view(account));
  return { ...result, client, switchAccount: (email: string) => result.rerender(view(email)) };
}
function popup() {
  const child = { opener: window, document: { title: '', body: { textContent: '' } }, location: { replace: vi.fn() }, focus: vi.fn(), close: vi.fn(), closed: false };
  vi.mocked(window.open).mockReturnValue(child as unknown as Window);
  return child;
}
async function openDetails(connected = false) {
  await userEvent.click(await screen.findByRole('button', { name: connected ? 'Gestionar conexión' : 'Conectar Amazon' }));
  return within(screen.getByRole('region', { name: 'Permisos de Amazon Seller Central' }));
}
beforeEach(() => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  vi.spyOn(window, 'focus').mockImplementation(() => undefined);
  vi.spyOn(api, 'get').mockResolvedValue(connection());
  vi.spyOn(api, 'post').mockResolvedValue({ authUrl, flowId });
  vi.spyOn(api, 'delete').mockResolvedValue({ disconnected: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('despliega permisos dentro de la conversación sin iniciar OAuth ni navegar', async () => {
  const original = window.location.href;
  mount();
  const details = await openDetails();
  expect(await details.findByText(account)).toBeInTheDocument();
  expect(details.getByText('Permisos que autorizas')).toBeInTheDocument();
  expect(details.getByText(/Conectar la cuenta no publica/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(window.location.href).toBe(original);
  expect(api.post).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar configuración de Amazon' }));
  const reopen = screen.getByRole('button', { name: 'Conectar Amazon' });
  await waitFor(() => expect(reopen).toHaveFocus());
});

it('un popup bloqueado conserva el panel y permite reintentar sin un flujo iniciado', async () => {
  mount();
  const details = await openDetails();
  await userEvent.click(details.getByRole('button', { name: 'Conectar Amazon' }));
  expect(await details.findByText(/ha bloqueado la ventana de Amazon/)).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  expect(details.getByRole('button', { name: 'Conectar Amazon' })).toBeEnabled();
});

it('conecta y vuelve al mismo chat solo tras recuperar el estado confirmado', async () => {
  const child = popup();
  let connected = false;
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === base) return connection(connected) as never;
    if (path === `${base}/flows/${flowId}`) { connected = true; return { status: 'success' } as never; }
    throw new Error('Ruta no esperada');
  });
  mount();
  const details = await openDetails();
  await userEvent.click(details.getByRole('button', { name: 'Conectar Amazon' }));
  expect(screen.getByRole('button', { name: 'Cerrar configuración de Amazon' })).toBeDisabled();
  expect(child.document.body.textContent).toMatch(/Tu trabajo permanece en esta conversación/);
  expect(await details.findByText('Amazon se ha conectado. Seguimos en esta conversación.')).toBeInTheDocument();
  expect(details.getByText('SELLER-OWNER')).toBeInTheDocument();
  expect(child.close).toHaveBeenCalled();
  expect(window.focus).toHaveBeenCalled();
  expect(details.getByRole('button', { name: 'Desconectar Amazon' })).toBeEnabled();
});

it('cancelar un permiso pendiente conserva el chat y cancela únicamente ese flujo', async () => {
  const child = popup();
  vi.mocked(api.get).mockImplementation(async path => (path === base ? connection() : { status: 'pending' }) as never);
  mount();
  const details = await openDetails();
  await userEvent.click(details.getByRole('button', { name: 'Conectar Amazon' }));
  await userEvent.click(details.getByRole('button', { name: 'Cancelar conexión' }));
  expect(await details.findByText('Conexión cancelada. Puedes volver a conectar Amazon desde esta conversación.')).toBeInTheDocument();
  expect(api.delete).toHaveBeenCalledWith(`${base}/flows/${flowId}`);
  expect(api.delete).not.toHaveBeenCalledWith(base);
  expect(child.close).toHaveBeenCalled();
});

it('la denegación de Amazon mantiene permisos y opción de reintentar en el chat', async () => {
  popup();
  vi.mocked(api.get).mockImplementation(async path => (path === base ? connection() : { status: 'error', error: 'access_denied' }) as never);
  mount();
  const details = await openDetails();
  await userEvent.click(details.getByRole('button', { name: 'Conectar Amazon' }));
  expect(await details.findByText(/No has concedido el permiso/)).toBeInTheDocument();
  expect(screen.getByText('Sin conectar')).toBeInTheDocument();
  expect(details.getByRole('button', { name: 'Conectar Amazon' })).toBeEnabled();
});

it('exige confirmación de desconexión y conserva la conexión al cancelar o fallar', async () => {
  vi.mocked(api.get).mockResolvedValue(connection(true));
  vi.mocked(api.delete).mockRejectedValue(new ApiError(503, { message: 'No se ha podido desconectar Amazon.' }));
  mount();
  const details = await openDetails(true);
  await userEvent.click(details.getByRole('button', { name: 'Desconectar Amazon' }));
  expect(api.delete).not.toHaveBeenCalled();
  await userEvent.click(details.getByRole('button', { name: 'Mantener conexión' }));
  expect(api.delete).not.toHaveBeenCalled();
  await userEvent.click(details.getByRole('button', { name: 'Desconectar Amazon' }));
  await userEvent.click(details.getByRole('button', { name: 'Confirmar desconexión' }));
  expect(await details.findByText('No se ha podido desconectar Amazon.')).toBeInTheDocument();
  expect(details.getByText('SELLER-OWNER')).toBeInTheDocument();
  expect(api.delete).toHaveBeenCalledWith(base);
});

it('desconecta en la API y ofrece reconectar en la misma conversación', async () => {
  let connected = true;
  vi.mocked(api.get).mockImplementation(async () => connection(connected) as never);
  vi.mocked(api.delete).mockImplementation(async () => { connected = false; return { disconnected: true } as never; });
  mount();
  const details = await openDetails(true);
  await userEvent.click(details.getByRole('button', { name: 'Desconectar Amazon' }));
  await userEvent.click(details.getByRole('button', { name: 'Confirmar desconexión' }));
  expect(await details.findByRole('button', { name: 'Conectar Amazon' })).toBeInTheDocument();
  expect(screen.getByText('Sin conectar')).toBeInTheDocument();
  expect(api.delete).toHaveBeenCalledTimes(1);
});

it('cambiar de cuenta descarta estado local, cancela la autorización y no muestra el vendedor anterior', async () => {
  const child = popup();
  vi.mocked(api.get).mockImplementation(async path => (path === base ? connection() : { status: 'pending' }) as never);
  const view = mount();
  const details = await openDetails();
  await userEvent.click(details.getByRole('button', { name: 'Conectar Amazon' }));
  view.switchAccount('next@example.test');
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${base}/flows/${flowId}`));
  expect(child.close).toHaveBeenCalled();
  expect(screen.queryByText(account)).not.toBeInTheDocument();
  expect(screen.queryByText(/Completa la autorización/)).not.toBeInTheDocument();
  const next = await openDetails();
  expect(await next.findByText('next@example.test')).toBeInTheDocument();
  expect(next.queryByText('SELLER-OWNER')).not.toBeInTheDocument();
});

it.each([false, true])('una desconexión tardía no consulta ni cambia estado tras cambiar de cuenta (rechazo: %s)', async rejected => {
  let finish!: () => void;
  let fail!: (reason: Error) => void;
  const deleting = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  vi.mocked(api.get).mockResolvedValue(connection(true));
  vi.mocked(api.delete).mockReturnValue(deleting);
  const view = mount();
  const details = await openDetails(true);
  await userEvent.click(details.getByRole('button', { name: 'Desconectar Amazon' }));
  await userEvent.click(details.getByRole('button', { name: 'Confirmar desconexión' }));
  expect(api.delete).toHaveBeenCalledTimes(1);
  vi.mocked(api.get).mockResolvedValue(connection());
  view.switchAccount('next@example.test');
  await screen.findByText('Sin conectar');
  const reads = vi.mocked(api.get).mock.calls.length;
  await act(async () => {
    if (rejected) fail(new Error('Respuesta de la cuenta anterior'));
    else finish();
    await deleting.catch(() => undefined);
  });
  expect(api.get).toHaveBeenCalledTimes(reads);
  expect(screen.queryByText(/Respuesta de la cuenta anterior|Amazon se ha desconectado/)).not.toBeInTheDocument();
  expect(screen.queryByText('SELLER-OWNER')).not.toBeInTheDocument();
  await waitFor(() => expect(view.client.getQueryData(['amazon-connection', account])).toBeUndefined());
  expect(view.client.getQueryData<AmazonState>(['amazon-connection', 'next@example.test'])?.connection.status).toBe('disconnected');
});

it('aborta la comprobación en curso cuando cambia la cuenta y descarta su respuesta tardía', async () => {
  let readingDisconnect = false;
  let nextAccount = false;
  let refreshSignal: AbortSignal | undefined;
  let finish!: (value: AmazonState) => void;
  const refreshed = new Promise<AmazonState>(resolve => { finish = resolve; });
  vi.mocked(api.get).mockImplementation(async (_path, options) => {
    if (nextAccount) return connection() as never;
    if (readingDisconnect) { refreshSignal = options?.signal; return refreshed as never; }
    return connection(true) as never;
  });
  vi.mocked(api.delete).mockImplementation(async () => { readingDisconnect = true; return {} as never; });
  const view = mount();
  const details = await openDetails(true);
  await userEvent.click(details.getByRole('button', { name: 'Desconectar Amazon' }));
  await userEvent.click(details.getByRole('button', { name: 'Confirmar desconexión' }));
  await waitFor(() => expect(refreshSignal).toBeInstanceOf(AbortSignal));
  expect(refreshSignal?.aborted).toBe(false);
  nextAccount = true;
  view.switchAccount('next@example.test');
  await screen.findByText('Sin conectar');
  expect(refreshSignal?.aborted).toBe(true);
  await act(async () => { finish(connection(true)); await refreshed; });
  expect(screen.queryByText('SELLER-OWNER')).not.toBeInTheDocument();
  expect(screen.queryByText(/No se ha confirmado la desconexión/)).not.toBeInTheDocument();
  await waitFor(() => expect(view.client.getQueryData(['amazon-connection', account])).toBeUndefined());
  expect(view.client.getQueryData<AmazonState>(['amazon-connection', 'next@example.test'])?.connection.status).toBe('disconnected');
});
