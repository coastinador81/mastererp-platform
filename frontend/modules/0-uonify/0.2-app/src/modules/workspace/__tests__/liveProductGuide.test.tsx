import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { useLiveHistory, sendLivePrompt } from '../hooks/liveConversation';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { setUi, useUiStore } from '../hooks/uiStore';
import { openWorkspacePage } from '../hooks/actions';
import type { ConversationFormData } from '../model/conversationForm';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'one@example.test', useSession: () => ({ status: 'ready', user: { email: 'one@example.test' } }) }));
vi.mock('../hooks/actions', async importOriginal => ({ ...await importOriginal<typeof import('../hooks/actions')>(), openWorkspacePage: vi.fn() }));
const form = { id: '10000000-0000-4000-8000-000000000001', title: 'Cómo continuar',
  fields: [{ id: 'mode', label: '¿Cómo quieres completar tu ficha?', type: 'select', required: true, options: ['Formulario interactivo', 'Módulo Producto'] }],
  context: { kind: 'product_guide', sku: 'JUEGO-1', revision: 1, section: 'choice' },
};
function History() { useLiveHistory(); return null; }
async function mount() {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [{ id: 't', title: 'T', service: null, view: 'default', messages: [{ role: 'assistant', text: 'Elige cómo continuar', conversationForm: form }] }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><History /></QueryClientProvider>);
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0]?.messages[0].conversationForm?.context).toEqual(form.context));
}
beforeEach(() => {
  resetWorkspaceStore(); setUi({ pendingReply: null });
  useComposerStore.setState({ draft: 'Mi borrador', status: '' });
  useGooglePreferences.setState({ account: null, data: null, saving: false });
  vi.mocked(openWorkspacePage).mockClear();
});
afterEach(() => vi.restoreAllMocks());

it('responde a la guía persistida sin depender de modelos y mantiene las respuestas en el hilo', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Empecemos por atributos.', model: 'uonify-guide', conversationForm: { ...form, context: { ...form.context, section: 'atributos' } } });
  await mount();
  const formResponse = { formId: form.id, answers: { mode: 'Formulario interactivo' } };
  expect(sendLivePrompt('Cómo continuar\nModo: Formulario interactivo', { preserveDraft: true, formResponse })).toBe(true);
  expect(useUiStore.getState().pendingReply).not.toHaveProperty('requirements');
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.model).toBe('uonify-guide'));
  expect(post.mock.calls[0][1]).toMatchObject({ threadId: 't', formResponse, model: 'auto', effort: 'medium' });
  expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.conversationFormFresh).toBe(true);
  expect(useComposerStore.getState().draft).toBe('Mi borrador');
  expect(openWorkspacePage).not.toHaveBeenCalled();
});

it.each([true, false])('solo abre el editor al confirmar elección manual y producto correspondiente: %s', async matching => {
  vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Continúa en Producto.', model: 'uonify-guide', productChanges: [{ product: { sku: matching ? 'JUEGO-1' : 'OTRO', name: 'Juego', revision: 2 } }] });
  await mount();
  expect(sendLivePrompt('Modo manual', { formResponse: { formId: form.id, answers: { mode: 'Módulo Producto' } } })).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  if (matching) expect(openWorkspacePage).toHaveBeenCalledWith('/espacio/producto/JUEGO-1');
  else expect(openWorkspacePage).not.toHaveBeenCalled();
});

it('no cambia de módulo ni deja una apertura automática pendiente si el cliente cambió de hilo durante la respuesta', async () => {
  let finish: (result: unknown) => void = () => {};
  vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  expect(sendLivePrompt('Modo manual', { formResponse: { formId: form.id, answers: { mode: 'Módulo Producto' } } })).toBe(true);
  act(() => useWorkspaceStore.setState({ activeThreadId: 'other' }));
  await act(async () => finish({ reply: 'Continúa en Producto.', conversationForm: { ...form, id: 'late-form' }, productChanges: [{ product: { sku: 'JUEGO-1', name: 'Juego' } }] }));
  expect(openWorkspacePage).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().threads[0].messages.at(-1)).toMatchObject({ conversationFormFresh: false, conversationForm: { id: 'late-form' } });
});

it('el envío real de requisitos identifica su pregunta para conservar un único indicador en el compositor', async () => {
  let finish: (result: unknown) => void = () => {};
  vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  const requirement: ConversationFormData = { id: form.id, title: 'Completar datos para Amazon', context: { kind: 'product_guide', sku: 'JUEGO-1', revision: 1,
    section: 'amazon_requirements', step: 'fields', evaluationId: 'evaluation' }, fields: [{ id: 'weight', label: 'Peso', type: 'text', required: true }] };
  useWorkspaceStore.setState(state => ({ threads: state.threads.map(thread => ({ ...thread, messages: [{ role: 'assistant' as const, text: 'Completa el dato pendiente.', conversationForm: requirement }] })) }));
  expect(sendLivePrompt('Peso: 100 g', { preserveDraft: true, formResponse: { formId: form.id, answers: { weight: '100 g' } } })).toBe(true);
  expect(useUiStore.getState().pendingReply).toMatchObject({ threadId: 't', requirements: { formId: form.id } });
  expect(useComposerStore.getState().draft).toBe('Mi borrador');
  await act(async () => finish({ reply: 'Tu respuesta está guardada.', model: 'uonify-guide' }));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
});
