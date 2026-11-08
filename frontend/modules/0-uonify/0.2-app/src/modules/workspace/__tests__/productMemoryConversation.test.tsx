import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { askProductAssistant, setActiveProduct, type PimProduct } from '@/shared/pim';
import { sendPrompt } from '../hooks/conversation';
import { useLiveHistory } from '../hooks/liveConversation';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { setUi, useUiStore } from '../hooks/uiStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  useSession: () => ({ status: 'ready', user: { email: identity.account } }) }));
function History() { useLiveHistory(); return null; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><History /></QueryClientProvider>);
}
const prompt = 'Quiero continuar la preparación de Basic Mini Bricks con Uony.';
const product = { sku: 'BASIC', revision: 3 };
const stored = { id: 'basic-thread', title: 'Basic', projectId: null, service: null, view: 'default', messages: [
  { role: 'user', text: 'Basic' }, { role: 'assistant', text: 'Hablemos de tu ficha.' },
] };
const memory = (version: number) => ({ productMemory: { product: { ...product, name: 'Basic Mini Bricks', linkVersion: version } } });
beforeEach(() => {
  identity.account = 'one@example.test';
  resetWorkspaceStore(); setUi({ pendingReply: null }); setActiveProduct(null);
  useComposerStore.setState({ draft: '', productLink: null, status: '' });
  useGooglePreferences.setState({ account: identity.account, saving: false,
    data: { models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
});
afterEach(() => vi.restoreAllMocks());

it('vincula al enviar, recupera el hilo al recargar y no cambia el vínculo por abrir otro editor', async () => {
  let messages = [...stored.messages];
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/uony/threads') return { threads: [{ ...stored, messages }] } as never;
    if (path === '/uony/threads/basic-thread/product-memory') return memory(4) as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const sent = body as { text: string; productAction?: unknown };
    const reply = sent.productAction ? 'Continuaremos con Basic Mini Bricks.' : 'Conservo Basic Mini Bricks.';
    messages = [...messages, { role: 'user', text: sent.text }, { role: 'assistant', text: reply }];
    return { reply, model: 'uonify-guide', effort: 'medium' } as never;
  });
  const first = mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => askProductAssistant(prompt, product));
  expect(useComposerStore.getState().draft).toBe(prompt);
  expect(post).not.toHaveBeenCalled();
  expect(sendPrompt(prompt)).toBe(true);
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.text).toBe('Continuaremos con Basic Mini Bricks.'));
  expect(get.mock.calls.filter(([path]) => path.endsWith('/product-memory'))).toHaveLength(1);
  expect(post.mock.calls[0][1]).toMatchObject({ threadId: 'basic-thread', model: 'auto', effort: 'medium',
    productAction: { action: 'link', sku: 'BASIC', revision: 3, expectedVersion: 4 } });
  expect(post.mock.calls[0][1]).not.toHaveProperty('productContext');
  first.unmount(); resetWorkspaceStore();
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0]?.messages.at(-1)?.text).toBe('Continuaremos con Basic Mini Bricks.'));
  setActiveProduct({ sku: 'OTHER', name: 'Otro producto', revision: 8 } as PimProduct);
  expect(sendPrompt('¿Qué dato de Basic falta?')).toBe(true);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1][1]).toMatchObject({ threadId: 'basic-thread', productContext: { sku: 'OTHER', revision: 8 } });
  expect(post.mock.calls[1][1]).not.toHaveProperty('productAction');
});

it('un hilo nuevo usa versión cero y no consulta un vínculo que aún no existe', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/uony/threads') return { threads: [] } as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Continuaremos con Basic Mini Bricks.', model: 'uonify-guide' });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => askProductAssistant(prompt, product));
  expect(sendPrompt(prompt)).toBe(true);
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][1]).toMatchObject({ productAction: { action: 'link', sku: 'BASIC', revision: 3, expectedVersion: 0 } });
  expect(post.mock.calls[0][1]).not.toHaveProperty('productContext');
  expect(get.mock.calls.some(([path]) => path.includes('product-memory'))).toBe(false);
});

it('Nueva conversación vacía seguida del CTA de Producto envía sin consultar el hilo aún no guardado', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/uony/threads') return { threads: [] } as never;
    throw new Error(`GET inesperado para un hilo local: ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Continuaremos con Basic Mini Bricks.', model: 'uonify-guide' });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  const thread = useWorkspaceStore.getState().createThread({ title: 'Nueva conversación', service: null, view: 'default' });
  expect(thread.messages).toHaveLength(0);
  act(() => askProductAssistant(prompt, product));
  expect(useComposerStore.getState().productLink?.threadId).toBe(thread.id);
  expect(post).not.toHaveBeenCalled();
  expect(sendPrompt(prompt)).toBe(true);
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][1]).toMatchObject({ threadId: thread.id,
    productAction: { action: 'link', sku: 'BASIC', revision: 3, expectedVersion: 0 } });
  expect(get.mock.calls.some(([path]) => path.includes('product-memory'))).toBe(false);
});

it('si la persona cambia el texto preparado, no se envía una vinculación tipada por sorpresa', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [stored] });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Hablemos de eso.', model: 'gemini-3.5-flash' });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => askProductAssistant(prompt, product));
  useComposerStore.getState().setDraft('Tengo otra pregunta');
  expect(useComposerStore.getState().productLink).toBeNull();
  expect(sendPrompt('Tengo otra pregunta')).toBe(true);
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][1]).not.toHaveProperty('productAction');
});

it('un hilo nuevo con red incierta reenvía la misma acción sin crear otro hilo', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [] });
  const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValueOnce({ reply: 'Continuaremos con Basic Mini Bricks.', model: 'uonify-guide' });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => askProductAssistant(prompt, product));
  expect(sendPrompt(prompt)).toBe(true);
  await waitFor(() => expect(useComposerStore.getState().productLink?.requestId).toBeTruthy());
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(useWorkspaceStore.getState().threads).toHaveLength(1);
  expect(sendPrompt(prompt)).toBe(true);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1]);
  expect(useWorkspaceStore.getState().threads).toHaveLength(1);
});

it('un conflicto 409 detiene la elección, conserva el texto y exige elegir de nuevo', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/uony/threads' ? { threads: [stored] } as never : memory(1) as never);
  const post = vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { error: 'product_link_conflict', message: 'Esta conversación ya cambió de producto.' }));
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => askProductAssistant(prompt, product));
  expect(sendPrompt(prompt)).toBe(true);
  // Lote 6: Uony pide elegir de nuevo en la conversación; el compositor conserva el texto sin el error.
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0].messages.at(-1)).toEqual({ role: 'assistant',
    model: 'uonify-guide', requestStatus: 'error', text: 'Esta conversación ya cambió de producto. '
      + 'Vuelve a elegir la ficha desde Producto para confirmar sus datos actuales.' }));
  expect(useComposerStore.getState().status).toBe('');
  expect(useComposerStore.getState().draft).toBe(prompt);
  expect(useComposerStore.getState().productLink).toBeNull();
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(3);
  expect(post).toHaveBeenCalledOnce();
});

it('tras un fallo de red, el reenvío manual conserva el identificador y la versión del primer intento', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path === '/uony/threads' ? { threads: [stored] } as never : memory(1) as never);
  const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({ reply: 'Continuaremos con Basic Mini Bricks.', model: 'uonify-guide' });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => askProductAssistant(prompt, product));
  expect(sendPrompt(prompt)).toBe(true);
  await waitFor(() => expect(useComposerStore.getState().productLink?.requestId).toBeTruthy());
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(sendPrompt(prompt)).toBe(true);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1]);
  expect(get.mock.calls.filter(([path]) => path.endsWith('/product-memory'))).toHaveLength(1);
});

it('cambiar de cuenta mientras se consulta la versión impide enviar la acción', async () => {
  let release: (value: unknown) => void = () => {};
  let requested = false;
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/uony/threads' ? { threads: [stored] } as never
    : new Promise(resolve => { requested = true; release = resolve; }) as never);
  const post = vi.spyOn(api, 'post');
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => askProductAssistant(prompt, product));
  expect(sendPrompt(prompt)).toBe(true);
  await waitFor(() => expect(requested).toBe(true));
  act(() => { identity.account = 'two@example.test'; window.dispatchEvent(new Event('uonify:identity-changed')); });
  await act(async () => release(memory(1)));
  expect(post).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(useComposerStore.getState().productLink).toBeNull();
});
