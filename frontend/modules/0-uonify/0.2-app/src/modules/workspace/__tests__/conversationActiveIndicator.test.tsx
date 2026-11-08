import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { ConversationActiveIndicator } from '../components/ConversationActiveIndicator';
import { Composer } from '../components/composer/Composer';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';
import { DURABLE_POST_UNCERTAIN, showDurableProgress } from '../hooks/durableDelivery';
import { useComposerStore } from '../hooks/composerStore';
import { DURABLE_READ_FORBIDDEN, DURABLE_READ_INTERRUPTED, DURABLE_READ_UNAUTHORIZED, watchDurableRequest } from '../hooks/durableRequestWatcher';

vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'sellerify@example.test',
  useSession: () => ({ user: null }) }));

function renderChatStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConversationActiveIndicator /><Composer /></QueryClientProvider>);
}

beforeEach(() => {
  resetWorkspaceStore();
  useWorkspaceStore.setState({ historyEpoch: 1, activeThreadId: 'basic-thread',
    threads: [{ id: 'basic-thread', title: 'Basic', service: null, view: 'default', messages: [] }] });
  setUi({ pendingReply: null });
  useComposerStore.setState({ status: '', draft: '' });
});
afterEach(() => { window.dispatchEvent(new Event('uonify:identity-changed')); vi.restoreAllMocks(); });

it('pinta una sola línea para la petición activa y cambia de fase sin crear mensajes', () => {
  setUi({ pendingReply: { threadId: 'basic-thread', requestId: 'request-1', label: 'Preparando tu respuesta…' } });
  render(<ConversationActiveIndicator />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  act(() => showDurableProgress('sellerify@example.test', 1, { requestId: 'request-1', threadId: 'basic-thread', status: 'running',
    progress: { stage: 'consulting_google', seq: 3 } }));
  expect(screen.getByRole('status')).toHaveTextContent('Uony está preparando tu respuesta…');
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(0);
});

it('deja el lugar al panel de requisitos sin duplicar un segundo estado', () => {
  setUi({ pendingReply: { threadId: 'basic-thread', requestId: 'request-1', label: 'Revisando los requisitos…', requirements: {} } });
  const { rerender } = render(<ConversationActiveIndicator />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => {
    setUi({ pendingReply: { threadId: 'basic-thread', requestId: 'request-1', label: 'Guardando tu respuesta…',
      requirements: { formId: 'form-1' } } });
    useWorkspaceStore.setState(state => ({ threads: [{ ...state.threads[0], messages: [
      { role: 'assistant', text: 'Completa tus datos', conversationForm: { id: 'form-1', title: 'Completar datos',
        context: { kind: 'product_guide', sku: 'BASIC', revision: 1, section: 'amazon_requirements', step: 'source' },
        fields: [{ id: 'answer', label: 'Tu respuesta', type: 'text', required: true }] } },
    ] }] }));
  });
  rerender(<ConversationActiveIndicator />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
});

it('durante GET 503 anuncia solo la reconexión sobre el cuadro y conserva el borrador', () => {
  useComposerStore.setState({ status: DURABLE_READ_INTERRUPTED, draft: 'Mi siguiente pregunta' });
  setUi({ pendingReply: { threadId: 'basic-thread', requestId: 'request-1', label: 'Preparando tu respuesta…' } });
  renderChatStatus();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent(DURABLE_READ_INTERRUPTED);
  expect(document.querySelector('.composer-live-status')).toHaveAttribute('hidden');
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Mi siguiente pregunta');
});

it('mantiene la incertidumbre del POST en un único indicador sin repetir el envío', () => {
  useComposerStore.setState({ status: DURABLE_POST_UNCERTAIN });
  setUi({ pendingReply: { threadId: 'basic-thread', requestId: 'request-1', label: 'Preparando tu respuesta…' } });
  renderChatStatus();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent(DURABLE_POST_UNCERTAIN);
  expect(document.querySelector('.composer-live-status')).toHaveAttribute('hidden');
});

it('sin petición activa muestra el aviso de recuperación debajo del cuadro', () => {
  useComposerStore.setState({ status: 'Estamos recuperando el estado de tu petición. Espera a que vuelva la conexión.' });
  renderChatStatus();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveClass('composer-live-status');
  expect(screen.getByRole('status')).toHaveTextContent('Estamos recuperando el estado de tu petición.');
});

it('mantiene visible un error final y no anuncia la fase anterior', () => {
  useComposerStore.setState({ status: 'La petición dejó de estar disponible. Conservamos tu texto y no la repetiremos automáticamente.' });
  renderChatStatus();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveClass('composer-live-status');
  expect(screen.queryByText('Preparando tu respuesta…')).not.toBeInTheDocument();
});

it.each([DURABLE_READ_INTERRUPTED, DURABLE_POST_UNCERTAIN, DURABLE_READ_UNAUTHORIZED, DURABLE_READ_FORBIDDEN])(
  'mantiene el aviso de %s solo en su hilo al cambiar de conversación', status => {
  useComposerStore.setState({ status });
  setUi({ pendingReply: { threadId: 'basic-thread', requestId: 'request-2', label: 'Preparando tu respuesta…' } });
  renderChatStatus();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  act(() => useWorkspaceStore.setState(state => ({ activeThreadId: 'other-thread', threads: [
    ...state.threads, { id: 'other-thread', title: 'Otro hilo', service: null, view: 'default', messages: [] },
  ] })));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(document.querySelector('.composer-live-status')).toHaveAttribute('hidden');
  act(() => useWorkspaceStore.setState({ activeThreadId: 'basic-thread' }));
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent(status);
});

it.each([404, 410])('tras GET %i terminal deja el error visible debajo sin un segundo indicador', async code => {
  const requestId = `request-${code}`;
  vi.spyOn(api, 'get').mockRejectedValue(new ApiError(code, { error: 'request_unavailable' }));
  useComposerStore.setState({ status: DURABLE_READ_INTERRUPTED, draft: 'Basic Mini Bricks' });
  setUi({ pendingReply: { threadId: 'basic-thread', requestId, label: 'Preparando tu respuesta…' } });
  renderChatStatus();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent(DURABLE_READ_INTERRUPTED);
  watchDurableRequest({ account: 'sellerify@example.test', epoch: 1, requestId, threadId: 'basic-thread',
    valid: () => true, settled: () => {}, missing: () => {
      setUi({ pendingReply: null });
      useComposerStore.getState().setStatus('La petición dejó de estar disponible. Conservamos tu texto y no la repetiremos automáticamente.');
    } });
  await waitFor(() => expect(screen.getByRole('status')).toHaveClass('composer-live-status'), { timeout: 4000 });
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('La petición dejó de estar disponible.');
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Basic Mini Bricks');
}, 5000);
