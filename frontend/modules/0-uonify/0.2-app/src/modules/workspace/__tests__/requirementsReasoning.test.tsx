import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { amazonRequirementsKey, type AmazonRequirements } from '@/modules/catalog';
import { ConversationRequirementsProgress } from '../components/ConversationRequirementsProgress';
import { prepareProductRequirements } from '../hooks/liveConversation';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';
import type { ConversationFormData } from '../model/conversationForm';

const identity = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
vi.mock('../hooks/liveConversation', () => ({ prepareProductRequirements: vi.fn() }));
let target: HTMLElement;
const form: ConversationFormData = { id: 'waiting-1', title: 'Revisión de Uony', fields: [], context: {
  kind: 'product_guide', sku: 'LAMP-2', revision: 2, section: 'amazon_requirements', step: 'reasoning' },
  reasoning: { id: 'job-1', status: 'running', message: 'Revisando los materiales disponibles.' } };
function result(status: NonNullable<AmazonRequirements['evaluation']['reasoning']>['status'] = 'running'): AmazonRequirements {
  return { product: { sku: 'LAMP-2', name: 'Lámpara USB', revision: 2, bullets: [], customFields: [] }, evaluation: {
    state: status === 'completed' ? 'needs_input' : 'reasoning', reasoning: { id: 'job-1', status, message: status === 'unknown' ? 'No conocemos el resultado de la ejecución.' : 'Revisando los materiales disponibles.' },
    evaluationId: 'evaluation-2', productType: 'LAMP', marketplaceId: 'A1RKKUPIHCS9HS', referenceAsin: null,
    schemaVersion: null, schemaChecksum: null, evaluatedAt: null, counts: { missing: 1, invalid: 0, questions: 1 },
    fields: [], attributes: [], issues: [], message: 'Revisión en curso.', localOnly: true,
  } };
}
function mount(initialForm = form, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } } })) {
  const element = (nextForm: ConversationFormData) => <QueryClientProvider client={client}><ConversationRequirementsProgress form={nextForm} account={identity.account}
    threadId="t" active questionTarget={target} /></QueryClientProvider>;
  const view = render(element(initialForm));
  return { client, ...view, showForm: (nextForm: ConversationFormData) => view.rerender(element(nextForm)) };
}
beforeEach(() => {
  identity.account = 'one@example.test'; resetWorkspaceStore(); setUi({ pendingReply: null });
  useWorkspaceStore.setState({ activeThreadId: 't' });
  vi.mocked(prepareProductRequirements).mockReset().mockReturnValue(true);
  target = document.createElement('div'); document.body.append(target);
});
afterEach(() => { target.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('espera sobre el compositor y consulta sin escribir ni abrir campos', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(result());
  const post = vi.spyOn(api, 'post');
  mount();
  expect(await screen.findByText('Uony está revisando tus documentos e imágenes')).toBeVisible();
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  expect(target).toContainElement(screen.getByRole('region', { name: 'Revisión de Uony para Amazon' }));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(prepareProductRequirements).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});

it('consulta periódicamente mientras trabaja y se detiene al recibir un error', async () => {
  vi.useFakeTimers();
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce(result()).mockResolvedValue(result('error'));
  mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(get).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  expect(get).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(get).toHaveBeenCalledTimes(2); expect(prepareProductRequirements).not.toHaveBeenCalled();
});

it('al terminar solicita una sola vez la pregunta vigente y no envía respuestas inventadas', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(result());
  const { client } = mount();
  await waitFor(() => expect(client.getQueryData([...amazonRequirementsKey(identity.account, 'LAMP-2'), ''])).toBeTruthy());
  act(() => client.setQueryData([...amazonRequirementsKey(identity.account, 'LAMP-2'), ''], result('completed')));
  await waitFor(() => expect(prepareProductRequirements).toHaveBeenCalledOnce());
  expect(prepareProductRequirements).toHaveBeenCalledWith('LAMP-2', expect.objectContaining({ onSettled: expect.any(Function) }));
  expect(vi.mocked(prepareProductRequirements).mock.calls[0][1]).not.toHaveProperty('retry');
  act(() => client.setQueryData([...amazonRequirementsKey(identity.account, 'LAMP-2'), ''], result('completed')));
  expect(prepareProductRequirements).toHaveBeenCalledOnce();
});

it('un resultado desconocido nunca reintenta automáticamente y exige aceptar el posible consumo', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(result('unknown'));
  mount();
  const button = await screen.findByRole('button', { name: 'Reintentar con Uony' });
  expect(button).toBeDisabled(); expect(prepareProductRequirements).not.toHaveBeenCalled();
  const consent = screen.getByRole('checkbox', { name: 'Hay un intento cuyo consumo no hemos podido confirmar. Entiendo que realizar otra revisión puede generar consumo adicional de IA.' });
  expect(consent).not.toBeChecked(); expect(screen.queryByText(/No sabemos si la ejecución anterior terminó/)).not.toBeInTheDocument();
  fireEvent.click(consent);
  fireEvent.click(button);
  expect(prepareProductRequirements).toHaveBeenCalledWith('LAMP-2', expect.objectContaining({ retry: true, acknowledgeUnknown: true }));
});

it('un error conserva la tarjeta y permite un reintento explícito sin cambiar de categoría', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(result('error'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Reintentar con Uony' }));
  expect(prepareProductRequirements).toHaveBeenCalledWith('LAMP-2', expect.objectContaining({ retry: true, acknowledgeUnknown: false }));
  act(() => vi.mocked(prepareProductRequirements).mock.calls[0][1]?.onSettled?.(false, 'Proveedor no disponible'));
  expect(screen.getByText('Proveedor no disponible')).toBeVisible();
  expect(screen.queryByText(/producto parecido/)).not.toBeInTheDocument();
});

it('un nuevo formulario del mismo producto supera el error en caché y continúa sin otro clic', async () => {
  vi.useFakeTimers();
  const failed = { ...form, reasoning: { ...form.reasoning!, status: 'error' as const } };
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce(result('error')).mockResolvedValueOnce(result()).mockResolvedValue(result('completed'));
  const view = mount(failed);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar con Uony' }));
  expect(prepareProductRequirements).toHaveBeenCalledOnce();
  act(() => vi.mocked(prepareProductRequirements).mock.calls[0][1]?.onSettled?.(true));
  view.showForm({ ...form, id: 'waiting-after-retry', reasoning: { ...form.reasoning!, status: 'queued' } });
  expect(screen.queryByRole('button', { name: 'Reintentar con Uony' })).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(get).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Uony está revisando tus documentos e imágenes')).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  expect(get).toHaveBeenCalledTimes(3);
  expect(prepareProductRequirements).toHaveBeenCalledTimes(2);
  expect(vi.mocked(prepareProductRequirements).mock.calls[1][1]).not.toHaveProperty('retry');
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(prepareProductRequirements).toHaveBeenCalledTimes(2);
});

it('no continúa usando un resultado completo anterior mientras consulta un formulario recién abierto', async () => {
  let finish: (value: AmazonRequirements) => void = () => {};
  const get = vi.spyOn(api, 'get').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, gcTime: 0 } } });
  client.setQueryData([...amazonRequirementsKey(identity.account, 'LAMP-2'), ''], result('completed'));
  mount(form, client);
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  expect(prepareProductRequirements).not.toHaveBeenCalled();
  expect(screen.getByText('Uony está revisando tus documentos e imágenes')).toBeVisible();
  await act(async () => { finish(result()); });
  expect(prepareProductRequirements).not.toHaveBeenCalled();
});

it('un límite sin capacidad de reintento permanece visible sin ofrecer un botón inútil', async () => {
  const state = result('error');
  state.evaluation.reasoning = { ...state.evaluation.reasoning!, canRetry: false, message: 'La comprobación alcanzó su límite de trabajo.' };
  vi.spyOn(api, 'get').mockResolvedValue(state); mount();
  expect(await screen.findByText('La comprobación alcanzó su límite de trabajo.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Reintentar con Uony' })).not.toBeInTheDocument();
  expect(prepareProductRequirements).not.toHaveBeenCalled();
});

it('un fallo de consulta solo reintenta la lectura del estado', async () => {
  vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValue(result());
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Consultar estado de nuevo' }));
  expect(await screen.findByText('Uony está revisando tus documentos e imágenes')).toBeVisible();
  expect(prepareProductRequirements).not.toHaveBeenCalled();
});

it('no continúa una revisión tardía en otro hilo ni toma el foco', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(result());
  const { client } = mount();
  const input = document.createElement('input'); document.body.append(input); input.focus();
  await waitFor(() => expect(client.getQueryData([...amazonRequirementsKey(identity.account, 'LAMP-2'), ''])).toBeTruthy());
  act(() => { useWorkspaceStore.setState({ activeThreadId: 'otro' }); client.setQueryData([...amazonRequirementsKey(identity.account, 'LAMP-2'), ''], result('completed')); });
  expect(prepareProductRequirements).not.toHaveBeenCalled(); expect(input).toHaveFocus(); input.remove();
});
