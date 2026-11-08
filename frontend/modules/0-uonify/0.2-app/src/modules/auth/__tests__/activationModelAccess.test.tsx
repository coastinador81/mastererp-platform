import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { ActivationCloud } from '../components/ActivationCloud';
import { ActivationRecovery } from '../components/ActivationRecovery';
import { setSession } from '../state/session';
import { parseSession } from '../model/session';
import type { ActivationState, SetupOperation } from '../model/activation';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/cloud', () => ({ GoogleAccountRule: () => null, useCloudWindow: () => ({ pending: null, message: '', open: vi.fn(), focus: vi.fn(), resume: vi.fn() }) }));
const account = 'model-access@example.test';
const id = '751670ed-ab1a-4236-8cc0-51628025def8';
const diagnosticPath = `/connections/google-cloud/setup/${id}/diagnostics`;
function operation(patch: Partial<SetupOperation> = {}): SetupOperation {
  return { id, status: 'action_required', step: 'model', projectId: 'uonify-own', projectName: 'Uonify', mode: 'create',
    billingAccountName: 'billingAccounts/own', modelTestConsent: true, message: 'La configuración está activa; falta revisar el acceso al modelo.',
    modelTest: 'failed', canResume: false, canRetryModel: false, canDiagnose: true,
    recovery: { kind: 'diagnostics', label: 'Revisar conexión con Uony', message: 'Revisaremos el acceso sin generar contenido.', url: null }, ...patch };
}
function eligible(previous = operation()): SetupOperation {
  return { ...previous, canRetryModel: previous.modelTest === 'failed', accessCheck: { status: 'eligible', checkedAt: new Date().toISOString(), nextCheckAt: null,
    message: 'El acceso al modelo responde. Autoriza una nueva prueba de respuesta para continuar.' } };
}
function mount(op = operation()) {
  const setup: ActivationState = { step: 'cloud', drive: { connected: false, deferred: true }, cloud: { connected: true, ready: false, projectId: 'uonify-own', projectName: 'Uonify', operation: op }, setupReady: false, aiReady: false, firstIntent: 'Crear mi producto' };
  return render(<QueryClientProvider client={queryClient}><ActivationCloud account={account} setup={setup} onReady={vi.fn(async () => {})} /></QueryClientProvider>);
}
beforeEach(() => {
  queryClient.clear(); setSession(parseSession({ authenticated: true, email: account, account: { provider: 'google' } }));
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/connections/google-cloud') return { connection: { status: 'connected' }, available: true } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
});
afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); });

it('el rechazo ofrece diagnóstico gratuito, y solo permite otra generación con autorización nueva', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, body) => {
    if (path === diagnosticPath) return { operation: eligible() } as never;
    if (path === '/connections/google-cloud/setup') return { operation: operation({ id: (body as { requestId: string }).requestId, status: 'ready', modelTest: 'passed', canDiagnose: false }) } as never;
    throw new Error(`Operación inesperada: ${path}`);
  });
  mount();
  expect(await screen.findByRole('button', { name: 'Revisar conexión con Uony' })).toBeEnabled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Revisar conexión con Uony' }));
  expect(post).toHaveBeenCalledExactlyOnceWith(diagnosticPath, {}, { signal: expect.any(AbortSignal) });
  expect(await screen.findByText('El acceso al modelo ya responde.')).toBeVisible();
  const checkbox = screen.getByRole('checkbox', { name: /Autorizo una nueva prueba de IA/ });
  expect(checkbox).not.toBeChecked();
  expect(screen.queryByRole('heading', { name: 'Tu IA está preparada' })).not.toBeInTheDocument();
  await userEvent.click(checkbox);
  await userEvent.click(screen.getByRole('button', { name: 'Autorizar nueva prueba con Uony' }));
  expect(await screen.findByRole('heading', { name: 'Tu IA está preparada' })).toBeVisible();
  expect(post.mock.calls[1][1]).toEqual({ requestId: expect.any(String), retryOf: id, acceptAdditionalModelCost: true, modelTestConsent: true });
  expect((post.mock.calls[1][1] as { requestId: string }).requestId).not.toBe(id);
});

it('un acceso todavía bloqueado conserva el resultado al recargar, sin otra prueba automática', async () => {
  const blocked = operation({ accessCheck: { status: 'unresolved', checkedAt: new Date().toISOString(), nextCheckAt: null, message: 'Google aún no confirma acceso al modelo. Uonify debe revisar esta conexión.' } });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ operation: blocked });
  const first = mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar conexión con Uony' }));
  expect(await screen.findByText(blocked.accessCheck!.message)).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  first.unmount(); mount(blocked);
  expect(await screen.findByText(blocked.accessCheck!.message)).toBeVisible();
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Ya lo he revisado, autorizar otra prueba/)).not.toBeInTheDocument();
});

it('la primera preparación espera el acceso y reanuda el mismo consentimiento sin crear un intento nuevo', async () => {
  const waiting = operation({ status: 'preparing', modelTest: 'not_started', accessCheck: { status: 'waiting', checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() - 1000).toISOString(), message: 'Esperamos a que Google termine de activar el acceso.' } });
  const checked = eligible(waiting); checked.canResume = true;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/connections/google-cloud') return { connection: { status: 'connected' }, available: true } as never;
    if (path === '/connections/google-cloud/setup') return { operation: waiting } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async path => {
    if (path === diagnosticPath) return { operation: checked } as never;
    return { operation: operation({ status: 'ready', modelTest: 'passed', canDiagnose: false }) } as never;
  });
  mount(waiting);
  expect(await screen.findByRole('heading', { name: 'Tu IA está preparada' })).toBeVisible();
  expect(post.mock.calls.map(([path, body]) => [path, body])).toEqual([[diagnosticPath, {}], ['/connections/google-cloud/setup', { requestId: id }]]);
});

it('respeta la espera indicada por el servidor y no consulta Google repetidamente', async () => {
  const waiting = operation({ accessCheck: { status: 'waiting', checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() + 60_000).toISOString(), message: 'La comprobación se repetirá cuando Google termine de preparar el acceso.' } });
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path === '/connections/google-cloud/setup' ? { operation: waiting } as never : { connection: { status: 'connected' }, available: true } as never);
  const post = vi.spyOn(api, 'post'); mount(waiting);
  await waitFor(() => expect(get.mock.calls.some(([path]) => path === '/connections/google-cloud/setup')).toBe(true));
  expect(await screen.findByText(waiting.accessCheck!.message)).toBeVisible();
  expect(post).not.toHaveBeenCalled();
});

it('una respuesta tardía del diagnóstico no cambia la pantalla de otra cuenta', async () => {
  let resolve!: (value: unknown) => void;
  vi.spyOn(api, 'post').mockImplementation(() => new Promise(finish => { resolve = finish; }) as never);
  mount(); await userEvent.click(await screen.findByRole('button', { name: 'Revisar conexión con Uony' }));
  expect(screen.getByRole('status')).toHaveTextContent('Revisando la conexión con Google');
  await act(async () => {
    setSession(parseSession({ authenticated: true, email: 'another@example.test', account: { provider: 'google' } }));
    resolve({ operation: operation({ status: 'ready', modelTest: 'passed' }) });
  });
  expect(screen.queryByRole('heading', { name: 'Tu IA está preparada' })).not.toBeInTheDocument();
});

it('si caduca el diagnóstico antes del consentimiento recupera la revisión, sin reenviar el intento rechazado', async () => {
  const previous = eligible();
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/connections/google-cloud/setup' ? { operation: operation() } as never : { connection: { status: 'connected' }, available: true } as never);
  const post = vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { error: 'setup_diagnostics_required', message: 'Primero revisaremos la conexión con Google sin generar contenido.' }));
  mount(previous);
  await userEvent.click(await screen.findByRole('checkbox', { name: /Autorizo una nueva prueba/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Autorizar nueva prueba con Uony' }));
  expect(await screen.findByRole('button', { name: 'Revisar conexión con Uony' })).toBeEnabled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1);
});

it('si Google exige autorización ofrece reconectar, sin ocultarlo con un diagnóstico o un reintento', async () => {
  const onOpen = vi.fn();
  const onDiagnose = vi.fn();
  const onRetryModel = vi.fn();
  render(<ActivationRecovery operation={operation({ canRetryModel: true, canDiagnose: true,
    recovery: { kind: 'authorization', label: 'Volver a conectar Google', url: null, message: 'Vuelve a autorizar tu cuenta de Google.' } })}
    busy={false} onOpen={onOpen} onDiagnose={onDiagnose} onRetryModel={onRetryModel} onResume={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Volver a conectar Google' }));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Revisar conexión con Uony' })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(onDiagnose).not.toHaveBeenCalled(); expect(onRetryModel).not.toHaveBeenCalled();
});
