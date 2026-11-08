import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ConversationActiveIndicator } from '../components/ConversationActiveIndicator';
import { ConversationMessages } from '../components/ConversationMessages';
import { showDurableProgress } from '../hooks/durableDelivery';
import { useComposerStore } from '../hooks/composerStore';
import { useLiveTranscriptPreview } from '../hooks/liveTranscriptPreview';
import { SLOW_THINKING_MS, useSlowThinking } from '../hooks/slowThinking';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';

// Lote 9 (maqueta aprobada por el dueño el 22-10-2026): si Google no empieza a responder en 20 s,
// «Uony está pensando…» pasa de la línea junto al compositor al sitio de la respuesta, y el texto
// lo sustituye al llegar. Red interna (D-ALL-TESTS-REAL-UI-ONLY-20261022): la prueba es en la interfaz.
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: null }) }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'one@example.test',
  useSession: () => ({ status: 'ready', user: { email: 'one@example.test' } }) }));

const ACCOUNT = 'one@example.test';
const THINKING = 'Uony está pensando…';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <ConversationMessages centredInService={false} />
    <ConversationActiveIndicator />
  </MemoryRouter></QueryClientProvider>);
}

const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  resetWorkspaceStore();
  useLiveTranscriptPreview.getState().clear();
  useComposerStore.setState({ status: '', draft: '', listening: null });
  useSlowThinking.setState({ threadId: null, since: 0, slow: false });
  useWorkspaceStore.setState({ activeThreadId: 'basic', historyAccount: ACCOUNT, threads: [{ id: 'basic', title: 'Lámpara',
    service: null, view: 'default', messages: [{ role: 'user', text: 'Escríbeme una descripción larga', requestId: 'r1' }] }] });
  setUi({ pendingReply: { threadId: 'basic', requestId: 'r1', label: 'Uony está preparando tu respuesta…' },
    provisionalReply: null });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('a los 20 s sin texto, el aviso pasa al sitio de la respuesta y no se repite junto al compositor', () => {
  const view = mount();
  wait(SLOW_THINKING_MS - 100);
  expect(screen.queryByText(THINKING)).not.toBeInTheDocument();
  expect(screen.getByText('Uony está preparando tu respuesta…')).toBeInTheDocument();
  wait(100);
  const bubble = view.container.querySelector('.message.assistant.is-thinking-slow');
  expect(bubble).toHaveTextContent(THINKING);
  expect(bubble).toHaveAttribute('role', 'status');
  expect(screen.queryByText('Uony está preparando tu respuesta…')).not.toBeInTheDocument();
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
});

it('cuando llega el texto, ocupa ese mismo sitio y el aviso desaparece', () => {
  const view = mount();
  wait(SLOW_THINKING_MS);
  expect(view.container.querySelector('.is-thinking-slow')).toBeInTheDocument();
  act(() => showDurableProgress(ACCOUNT, useWorkspaceStore.getState().historyEpoch, { requestId: 'r1', threadId: 'basic',
    status: 'running', progress: { stage: 'consulting_google', seq: 11, provisional: { text: 'Ilumina tus tardes', seq: 1, tentative: true } } }));
  expect(view.container.querySelector('.is-thinking-slow')).toBeNull();
  expect(view.container.querySelector('.message.assistant.is-writing')).toHaveTextContent('Ilumina tus tardes');
});

it('si la respuesta termina antes de 20 s, el aviso no llega a salir', () => {
  const view = mount();
  wait(5_000);
  act(() => setUi({ pendingReply: null }));
  wait(SLOW_THINKING_MS);
  expect(view.container.querySelector('.is-thinking-slow')).toBeNull();
});

it('Drive y la voz conservan su propio aviso', () => {
  act(() => setUi({ pendingReply: { threadId: 'basic', requestId: 'r1', label: 'Uony está revisando tu Drive…',
    purpose: 'drive_access' } }));
  const view = mount();
  wait(SLOW_THINKING_MS * 2);
  expect(view.container.querySelector('.is-thinking-slow')).toBeNull();
  expect(screen.getByText('Uony está revisando tu Drive…')).toBeInTheDocument();
  act(() => {
    setUi({ pendingReply: { threadId: 'basic', requestId: 'r2', label: 'Uony está preparando tu respuesta…' } });
    useComposerStore.setState({ listening: 'talk' });
  });
  wait(SLOW_THINKING_MS * 2);
  expect(view.container.querySelector('.is-thinking-slow')).toBeNull();
});

it('si la conversación cambia de sitio, el aviso no vuelve a empezar la cuenta', () => {
  const first = mount();
  wait(15_000);
  first.unmount();
  const second = mount();
  wait(5_000);
  expect(second.container.querySelector('.is-thinking-slow')).toHaveTextContent(THINKING);
});
