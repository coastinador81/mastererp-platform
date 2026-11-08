import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { ActivationCloud } from '../components/ActivationCloud';
import { setSession } from '../state/session';
import { parseSession } from '../model/session';
import type { ActivationState, SetupOperation } from '../model/activation';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const cloud = vi.hoisted(() => ({ completed: null as null | ((kind: 'authorization' | 'billing') => Promise<void>), open: vi.fn() }));
vi.mock('@/modules/cloud', () => ({ GoogleAccountRule: () => null, useCloudWindow: (completed: NonNullable<typeof cloud.completed>) => {
  cloud.completed = completed;
  return { pending: null, message: '', open: cloud.open, focus: vi.fn(), resume: vi.fn() };
} }));
const account = 'cloud-activation@example.test';
const id = '751670ed-ab1a-4236-8cc0-51628025def8';
function operation(patch: Partial<SetupOperation> = {}): SetupOperation {
  return { id, status: 'action_required', step: 'billing_required', projectId: 'uonify-own', projectName: 'Uonify',
    mode: 'create', billingAccountName: null, modelTestConsent: false, message: 'Elige la facturación de Google.', canResume: true, modelTest: 'not_started', ...patch };
}
function mount(op: SetupOperation | null = operation()) {
  const setup: ActivationState = { step: 'cloud', drive: { connected: false, deferred: true }, cloud: { connected: true, ready: false, projectId: 'uonify-own', projectName: 'Uonify', operation: op }, setupReady: false, aiReady: false, firstIntent: '' };
  const done = vi.fn(async () => {});
  render(<QueryClientProvider client={queryClient}><ActivationCloud account={account} setup={setup} onReady={done} /></QueryClientProvider>);
  return done;
}
beforeEach(() => {
  queryClient.clear();
  cloud.completed = null; cloud.open.mockReset();
  setSession(parseSession({ authenticated: true, email: account, account: { provider: 'google' } }));
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/connections/google-cloud') return { connection: { status: 'connected' }, available: true, accessAllowed: false, preparationAllowed: true } as never;
    if (path === '/connections/google-cloud/billing-accounts') return { accounts: [{ name: 'billingAccounts/own', displayName: 'Mi cuenta', open: true }] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
});
afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('añade facturación a la operación recuperada con el mismo identificador y aprobación explícita', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ operation: operation({ status: 'ready', step: 'ready', modelTest: 'passed' }) });
  const done = mount();
  await userEvent.selectOptions(await screen.findByLabelText('Facturación de Google'), 'billingAccounts/own');
  const button = screen.getByRole('button', { name: 'Continuar preparación con Uony' });
  expect(button).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: /Autorizo una comprobación mínima/ }));
  await userEvent.click(button);
  expect(post).toHaveBeenCalledExactlyOnceWith('/connections/google-cloud/setup', { requestId: id, billingAccountName: 'billingAccounts/own', configurationApproved: true, modelTestConsent: true }, { signal: expect.any(AbortSignal) });
  expect(await screen.findByRole('heading', { name: 'Tu IA está preparada' })).toBeVisible();
  expect(screen.getByText(/Hemos comprobado su facturación y los permisos/)).toBeVisible();
  expect(done).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(done).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('un resultado desconocido no vuelve a ejecutar una prueba de IA', async () => {
  const post = vi.spyOn(api, 'post');
  mount(operation({ status: 'unknown', modelTest: 'unknown', modelTestConsent: true, canResume: false, message: 'Resultado por comprobar' }));
  expect(await screen.findByText('Resultado por comprobar')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Preparar mi IA con Uony' })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});

it('si se interrumpe la respuesta conserva el identificador de la preparación al reintentar', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('Se interrumpió la conexión')).mockResolvedValueOnce({ operation: operation({ status: 'ready', modelTest: 'passed' }) });
  mount();
  await userEvent.selectOptions(await screen.findByLabelText('Facturación de Google'), 'billingAccounts/own');
  await userEvent.click(screen.getByRole('checkbox', { name: /Autorizo una comprobación mínima/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar preparación con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Se interrumpió la conexión');
  await userEvent.click(screen.getByRole('button', { name: 'Consultar la solicitud pendiente con Uony' }));
  expect(post.mock.calls.map(call => (call[1] as { requestId: string }).requestId)).toEqual([id, id]);
});

it('con facturación disponible prepara directamente, sin comprobación redundante, y permite cambiar la elección todavía no aprobada', async () => {
  const post = vi.spyOn(api, 'post');
  mount(null);
  await userEvent.click(await screen.findByRole('button', { name: 'Sí, crear un proyecto Uonify' }));
  await screen.findByLabelText('Facturación de Google');
  expect(screen.queryByRole('button', { name: /Ya he terminado, comprobar/ })).not.toBeInTheDocument();
  const manage = screen.getByText('Abrir Google ↗');
  expect(screen.getByRole('button', { name: 'Gestionar mi facturación de Google' })).toHaveAttribute('aria-expanded', 'false');
  expect(manage).not.toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Cambiar elección' }));
  expect(screen.getByRole('button', { name: 'Sí, crear un proyecto Uonify' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'No, elegir uno que ya tengo' })).toBeVisible();
  expect(post).not.toHaveBeenCalled();
});

it('una operación recuperada mantiene su elección aprobada y su identificador', async () => {
  mount();
  await screen.findByLabelText('Facturación de Google');
  expect(screen.queryByRole('button', { name: 'Cambiar elección' })).not.toBeInTheDocument();
});

it('si faltaba facturación la recupera al volver de la ventana oficial, sin añadir otro botón de comprobación', async () => {
  let calls = 0;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/connections/google-cloud') return { connection: { status: 'connected' }, available: true } as never;
    if (path === '/connections/google-cloud/billing-accounts') return { accounts: ++calls === 1 ? [] : [{ name: 'billingAccounts/new', displayName: 'Mi cuenta nueva', open: true }] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  mount(null);
  await userEvent.click(await screen.findByRole('button', { name: 'Sí, crear un proyecto Uonify' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Preparar facturación en Google ↗' }));
  expect(cloud.open).toHaveBeenCalledExactlyOnceWith('billing', account);
  await act(async () => { await cloud.completed?.('billing'); });
  expect(await screen.findByRole('option', { name: 'Mi cuenta nueva' })).toBeInTheDocument();
  expect(calls).toBe(2);
  expect(screen.queryByRole('button', { name: /Ya he terminado, comprobar/ })).not.toBeInTheDocument();
});

it('un bloqueo de permisos abre su página oficial y reanuda la misma operación sin pedir facturación', async () => {
  const url = 'https://console.cloud.google.com/iam-admin/iam?project=uonify-own';
  const post = vi.spyOn(api, 'post').mockResolvedValue({ operation: operation({ status: 'ready', modelTest: 'passed' }) });
  mount(operation({ mode: 'existing', step: 'permissions_required', modelTestConsent: true,
    recovery: { kind: 'permissions', message: 'Autoriza el permiso necesario en tu proyecto.', label: 'Revisar permisos en Google', url } }));
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar permisos en Google' }));
  expect(cloud.open).toHaveBeenCalledExactlyOnceWith('billing', account, url);
  expect(screen.queryByLabelText('Facturación de Google')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ya lo he revisado, continuar' }));
  expect(post).toHaveBeenCalledExactlyOnceWith('/connections/google-cloud/setup', { requestId: id, modelTestConsent: true }, { signal: expect.any(AbortSignal) });
});

it('una prueba desconocida requiere autorización nueva y conserva el mismo nuevo intento si se interrumpe su respuesta', async () => {
  const previous = operation({ status: 'unknown', modelTest: 'unknown', modelTestConsent: true, canResume: false, canRetryModel: true,
    recovery: { kind: 'retry_model', message: 'No sabemos si Google terminó la prueba anterior.', label: 'Nueva prueba', url: null } });
  const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('Respuesta interrumpida')).mockImplementationOnce(async (_path, body) => ({ operation: { ...previous, id: (body as { requestId: string }).requestId, retryOf: id, additionalModelCostAccepted: true } }) as never);
  mount(previous);
  const button = await screen.findByRole('button', { name: 'Autorizar nueva prueba con Uony' });
  const checkbox = screen.getByRole('checkbox', { name: /Autorizo una nueva prueba de IA/ });
  expect(checkbox).not.toBeChecked(); expect(button).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  await userEvent.click(checkbox); await userEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Respuesta interrumpida');
  await userEvent.click(button);
  expect(post).toHaveBeenCalledTimes(2);
  const firstBody = post.mock.calls[0][1] as { requestId: string; retryOf: string };
  expect(firstBody).toEqual({ requestId: expect.any(String), retryOf: id, acceptAdditionalModelCost: true, modelTestConsent: true });
  expect(firstBody.requestId).not.toBe(id);
  expect(post.mock.calls[1][1]).toEqual(firstBody);
  expect(screen.getByRole('checkbox', { name: /Autorizo una nueva prueba de IA/ })).not.toBeChecked();
  expect(previous.id).toBe(id);
});

it('cambiar la cuenta de facturación de una operación bloqueada crea una revisión explícita del mismo proyecto', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => ({ operation: operation({ id: (body as { requestId: string }).requestId, mode: 'existing', billingAccountName: 'billingAccounts/own', revisionOf: id, status: 'ready', modelTest: 'passed' }) }) as never);
  const previous = operation({ billingAccountName: 'billingAccounts/old', modelTestConsent: true,
    recovery: { kind: 'billing', message: 'La cuenta elegida no permite continuar.', label: 'Revisar facturación en Google', url: 'https://console.cloud.google.com/billing' } });
  mount(previous);
  await userEvent.selectOptions(await screen.findByLabelText('Facturación de Google'), 'billingAccounts/own');
  expect(screen.getByRole('checkbox', { name: /Autorizo una comprobación mínima/ })).not.toBeChecked();
  await userEvent.click(screen.getByRole('checkbox', { name: /Autorizo una comprobación mínima/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Autorizar cambio de facturación con Uony' }));
  expect(post).toHaveBeenCalledOnce();
  const body = post.mock.calls[0][1] as { requestId: string };
  expect(body).toEqual({ requestId: expect.any(String), revisionOf: id, mode: 'existing', projectId: 'uonify-own', billingAccountName: 'billingAccounts/own', configurationApproved: true, modelTestConsent: true });
  expect(body.requestId).not.toBe(id);
  expect(previous.id).toBe(id); expect(previous.billingAccountName).toBe('billingAccounts/old');
});

it('una prueba rechazada por Google permite corregir permisos y autorizar otra prueba, sin reutilizar su llamada fallida', async () => {
  const url = 'https://console.cloud.google.com/iam-admin/quotas?project=uonify-own';
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => ({ operation: operation({ id: (body as { requestId: string }).requestId, status: 'ready', modelTest: 'passed' }) }) as never);
  mount(operation({ status: 'action_required', modelTest: 'failed', canResume: false, modelTestConsent: true, canRetryModel: true,
    recovery: { kind: 'model', message: 'Google rechazó la prueba. Revisa los permisos o la cuota.', label: 'Revisar en Google', url } }));
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar en Google' }));
  expect(cloud.open).toHaveBeenCalledExactlyOnceWith('billing', account, url);
  const checkbox = screen.getByRole('checkbox', { name: /Autorizo una nueva prueba de IA/ });
  expect(checkbox).not.toBeChecked(); expect(post).not.toHaveBeenCalled();
  await userEvent.click(checkbox);
  await userEvent.click(screen.getByRole('button', { name: 'Autorizar nueva prueba con Uony' }));
  const body = post.mock.calls[0][1] as { requestId: string };
  expect(body).toEqual({ requestId: expect.any(String), retryOf: id, acceptAdditionalModelCost: true, modelTestConsent: true });
  expect(body.requestId).not.toBe(id);
});

it('cada rechazo confirmado de una nueva prueba se anuncia, recibe foco y exige otra autorización vacía', async () => {
  const rejected = operation({ modelTest: 'failed', canResume: false, modelTestConsent: true, canRetryModel: true,
    errorDetails: { category: 'policy', message: 'Google no permite utilizar la IA en este proyecto.' },
    recovery: { kind: 'model', message: 'Revisa las condiciones de uso del proyecto en Google antes de volver a probar.', label: 'Revisar en Google', url: 'https://console.cloud.google.com/vertex-ai' } });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => ({ operation: { ...rejected, id: (body as { requestId: string }).requestId, retryOf: (body as { retryOf: string }).retryOf } }) as never);
  const done = mount(rejected);
  expect(await screen.findByRole('alert')).toHaveTextContent('Google ha rechazado');
  expect(screen.queryByText(/La anterior podría haberse procesado/)).not.toBeInTheDocument();
  for (let attempt = 0; attempt < 2; attempt++) {
    const checkbox = screen.getByRole('checkbox', { name: /Autorizo una nueva prueba/ });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: 'Autorizar nueva prueba con Uony' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Google ha vuelto a rechazar la comprobación de IA.');
    expect(alert).toHaveTextContent('Revisa las condiciones de uso del proyecto');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByRole('checkbox', { name: /Autorizo una nueva prueba/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Autorizar nueva prueba con Uony' })).toBeDisabled();
  }
  expect(post).toHaveBeenCalledTimes(2);
  const first = post.mock.calls[0][1] as { requestId: string };
  expect(post.mock.calls[1][1]).toMatchObject({ requestId: expect.any(String), retryOf: first.requestId });
  expect((post.mock.calls[1][1] as { requestId: string }).requestId).not.toBe(first.requestId);
  expect(done).not.toHaveBeenCalled();
});

it('muestra Comprobando mientras Google responde y conserva el resultado desconocido sin repetirlo', async () => {
  const previous = operation({ status: 'unknown', modelTest: 'unknown', canResume: false, canRetryModel: true,
    recovery: { kind: 'retry_model', message: 'No sabemos si Google terminó la prueba anterior.', label: 'Nueva prueba', url: null } });
  let finish!: (value: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve; }) as never);
  const done = mount(previous);
  const checkbox = await screen.findByRole('checkbox', { name: /Autorizo una nueva prueba/ });
  expect(checkbox).toHaveAccessibleName(/La anterior podría haberse procesado/);
  await userEvent.click(checkbox);
  await userEvent.click(screen.getByRole('button', { name: 'Autorizar nueva prueba con Uony' }));
  expect(screen.getByRole('status')).toHaveTextContent('Comprobando la IA con Google…');
  expect(screen.getByRole('button', { name: 'Comprobando…' })).toBeDisabled();
  const body = post.mock.calls[0][1] as { requestId: string };
  await act(async () => { finish({ operation: { ...previous, id: body.requestId, retryOf: id } }); });
  expect(await screen.findByRole('alert')).toHaveTextContent('No hemos podido confirmar el resultado');
  expect(screen.getByRole('checkbox', { name: /Autorizo una nueva prueba/ })).not.toBeChecked();
  expect(post).toHaveBeenCalledOnce(); expect(done).not.toHaveBeenCalled();
});

it('una comprobación pendiente consulta su estado y no vuelve a llamar a la prueba', async () => {
  const pending = operation({ status: 'preparing', modelTest: 'pending', step: 'model_test', message: 'Comprobando la IA.', canResume: true });
  const original = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation(async (path, options) => path === '/connections/google-cloud/setup' ? { operation: pending } as never : original(path, options));
  const post = vi.spyOn(api, 'post'); const done = mount(pending);
  expect(await screen.findByText('Comprobando la IA con Google…')).toBeVisible();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/connections/google-cloud/setup', { signal: expect.any(AbortSignal) }));
  expect(post).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
});

it('una prueba que termina al consultar el estado deja el resumen visible hasta pulsar Continuar', async () => {
  const pending = operation({ status: 'preparing', modelTest: 'pending', step: 'model_test', canResume: true });
  const original = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation(async (path, options) => path === '/connections/google-cloud/setup' ? { operation: { ...pending, status: 'ready', modelTest: 'passed' } } as never : original(path, options));
  const post = vi.spyOn(api, 'post');
  const done = mount(pending);
  expect(await screen.findByRole('heading', { name: 'Tu IA está preparada' })).toBeVisible();
  expect(done).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(done).toHaveBeenCalledOnce();
  expect(post).not.toHaveBeenCalled();
});

it('en pantalla pequeña separa los datos de la autorización y conserva la selección al volver', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const post = vi.spyOn(api, 'post').mockResolvedValue({ operation: operation({ status: 'ready', modelTest: 'passed' }) });
  mount(null);
  await userEvent.click(await screen.findByRole('button', { name: 'Sí, crear un proyecto Uonify' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la facturación' }));
  const billing = await screen.findByLabelText('Facturación de Google');
  await userEvent.selectOptions(billing, 'billingAccounts/own');
  expect(screen.queryByRole('checkbox', { name: /Autorizo una prueba mínima/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  const consent = screen.getByRole('checkbox', { name: /Autorizo una prueba mínima/ });
  expect(consent).not.toBeChecked(); expect(billing).not.toBeVisible();
  await userEvent.click(consent);
  await userEvent.click(screen.getByRole('button', { name: 'Proyecto y condiciones' }));
  await userEvent.click(screen.getByRole('button', { name: 'Volver a proyecto y facturación' }));
  expect(billing).toBeVisible(); expect(billing).toHaveValue('billingAccounts/own');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  expect(consent).toBeChecked(); expect(post).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Preparar mi IA con Uony' }));
  expect(post).toHaveBeenCalledOnce();
});

it('en compacto separa el proyecto existente y la facturación, conserva ambos al volver y no prepara nada al navegar', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const get = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation(async (path, options) => path === '/connections/google-cloud/projects' ? { projects: [{ id: 'customer-project', name: 'Proyecto de mi empresa' }] } as never : get(path, options));
  const post = vi.spyOn(api, 'post').mockResolvedValue({ operation: operation({ status: 'ready', modelTest: 'passed', mode: 'existing' }) });
  mount(null);
  await userEvent.click(await screen.findByRole('button', { name: 'No, elegir uno que ya tengo' }));
  const project = screen.getByRole('combobox', { name: 'Tu proyecto de Google' });
  await screen.findByRole('option', { name: 'Proyecto de mi empresa · customer-project' });
  await userEvent.selectOptions(project, 'customer-project');
  expect(screen.queryByRole('combobox', { name: 'Facturación de Google' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la facturación' }));
  const billing = screen.getByRole('combobox', { name: 'Facturación de Google' });
  expect(project).not.toBeVisible();
  await userEvent.selectOptions(billing, 'billingAccounts/own');
  await userEvent.click(screen.getByRole('button', { name: 'Volver al proyecto' }));
  expect(project).toBeVisible(); expect(project).toHaveValue('customer-project');
  expect(billing).not.toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la facturación' }));
  expect(billing).toHaveValue('billingAccounts/own');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  const consent = screen.getByRole('checkbox', { name: /Autorizo una prueba mínima/ });
  expect(consent).not.toBeChecked(); expect(post).not.toHaveBeenCalled();
  await userEvent.click(consent);
  await userEvent.click(screen.getByRole('button', { name: 'Preparar mi IA con Uony' }));
  expect(post).toHaveBeenCalledExactlyOnceWith('/connections/google-cloud/setup', { requestId: expect.any(String), mode: 'existing', projectId: 'customer-project', billingAccountName: 'billingAccounts/own', configurationApproved: true, modelTestConsent: true }, { signal: expect.any(AbortSignal) });
});

it.each(['api', 'permissions', 'billing'] as const)('un rechazo de tipo %s ofrece una nueva prueba consentida aunque no permita reanudar', async kind => {
  const previous = operation({ modelTest: 'failed', modelTestConsent: true, canResume: false, canRetryModel: true,
    billingAccountName: 'billingAccounts/old', recovery: { kind, message: 'Google ha rechazado la prueba. Revisa este paso en Google.', label: 'Revisar en Google', url: 'https://console.cloud.google.com/vertex-ai' } });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => ({ operation: { ...previous, id: (body as { requestId: string }).requestId, retryOf: id } }) as never);
  const done = mount(previous);
  const checkbox = await screen.findByRole('checkbox', { name: /Autorizo una nueva prueba/ });
  const button = screen.getByRole('button', { name: 'Autorizar nueva prueba con Uony' });
  expect(checkbox).not.toBeChecked(); expect(button).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Ya lo he revisado, continuar' })).not.toBeInTheDocument();
  await userEvent.click(checkbox); await userEvent.click(button);
  expect(post).toHaveBeenCalledExactlyOnceWith('/connections/google-cloud/setup', { requestId: expect.any(String), retryOf: id, acceptAdditionalModelCost: true, modelTestConsent: true }, { signal: expect.any(AbortSignal) });
  expect(done).not.toHaveBeenCalled();
});

it('la facturación rechazada permite una revisión del mismo proyecto únicamente con selección y consentimiento nuevos', async () => {
  const previous = operation({ modelTest: 'failed', modelTestConsent: true, canResume: false, canRetryModel: true,
    billingAccountName: 'billingAccounts/old', recovery: { kind: 'billing', message: 'Google no acepta esta facturación.', label: 'Revisar facturación', url: 'https://console.cloud.google.com/billing' } });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => ({ operation: { ...previous, id: (body as { requestId: string }).requestId, modelTest: 'passed', status: 'ready' } }) as never);
  mount(previous);
  await userEvent.click(await screen.findByRole('button', { name: 'Cambiar la facturación' }));
  await userEvent.click(screen.getByRole('button', { name: 'Elegir otra cuenta de facturación' }));
  expect(screen.queryByRole('button', { name: 'Autorizar nueva prueba con Uony' })).not.toBeInTheDocument();
  await userEvent.selectOptions(await screen.findByLabelText('Facturación de Google'), 'billingAccounts/own');
  const checkbox = screen.getByRole('checkbox', { name: /Autorizo una comprobación mínima/ });
  const button = screen.getByRole('button', { name: 'Autorizar cambio de facturación con Uony' });
  expect(checkbox).not.toBeChecked(); expect(button).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  await userEvent.click(checkbox); await userEvent.click(button);
  const body = post.mock.calls[0][1] as { requestId: string };
  expect(body).toEqual({ requestId: expect.any(String), revisionOf: id, mode: 'existing', projectId: 'uonify-own', billingAccountName: 'billingAccounts/own', configurationApproved: true, modelTestConsent: true });
  expect(body.requestId).not.toBe(id);
  expect(previous.billingAccountName).toBe('billingAccounts/old');
});

it('en recuperación compacta revisar el resultado no llama a Google y la nueva prueba sigue exigiendo su casilla', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const previous = operation({ modelTest: 'failed', modelTestConsent: true, canResume: false, canRetryModel: true,
    recovery: { kind: 'permissions', message: 'Google no permite esta comprobación en el proyecto.', label: 'Revisar permisos en Google', url: 'https://console.cloud.google.com/iam-admin' } });
  const post = vi.spyOn(api, 'post'); mount(previous);
  expect(await screen.findByRole('alert')).toHaveTextContent('Google no permite esta comprobación');
  expect(screen.queryByRole('checkbox', { name: /Autorizo una nueva prueba/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ya lo he revisado, autorizar otra prueba' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const checkbox = screen.getByRole('checkbox', { name: /Autorizo una nueva prueba/ });
  expect(checkbox).not.toBeChecked(); expect(screen.getByRole('button', { name: 'Autorizar nueva prueba con Uony' })).toBeDisabled();
  await waitFor(() => expect(checkbox).toHaveFocus());
  expect(post).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Revisar el problema anterior' }));
  expect(screen.getByText('Google no permite esta comprobación en el proyecto.', { selector: 'section.activation-recovery p' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Volver al resultado' }));
  expect(screen.getByRole('alert')).toBeVisible();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(post).not.toHaveBeenCalled();
});
