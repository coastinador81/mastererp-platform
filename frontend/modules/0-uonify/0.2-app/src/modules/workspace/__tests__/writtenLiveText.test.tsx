import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { api } from '@/shared/api/client';
import { ConversationMessages } from '../components/ConversationMessages';
import { settleDurableRequest, showDurableProgress } from '../hooks/durableDelivery';
import { LIVE_TEXT_POLL_MS, watchDurableRequest } from '../hooks/durableRequestWatcher';
import { useLiveTranscriptPreview } from '../hooks/liveTranscriptPreview';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi, useUiStore } from '../hooks/uiStore';
import type { DurableRequest } from '../api/durableRequests';

// F1-S (lote 8, maqueta «A · Va apareciendo» aprobada por el dueño el 22-10-2026): la respuesta
// escrita crece mientras Uony la escribe y la sustituye la definitiva; si falla, el texto a medias
// desaparece y Uony lo dice en la conversación. Red interna (D-ALL-TESTS-REAL-UI-ONLY-20261022).
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: null }) }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'one@example.test',
  useSession: () => ({ status: 'ready', user: { email: 'one@example.test' } }) }));

const ACCOUNT = 'one@example.test';
const running = (text: string, seq: number): DurableRequest => ({ requestId: 'r1', threadId: 'basic', status: 'running',
  progress: { stage: 'consulting_google', seq: seq + 10, provisional: { text, seq, tentative: true } } });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <ConversationMessages centredInService={false} />
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  resetWorkspaceStore();
  useLiveTranscriptPreview.getState().clear();
  useWorkspaceStore.setState({ activeThreadId: 'basic', historyAccount: ACCOUNT, threads: [{ id: 'basic', title: 'Drive',
    service: null, view: 'default', messages: [{ role: 'user', text: '¿Qué carpetas tengo?', requestId: 'r1' }] }] });
  setUi({ pendingReply: { threadId: 'basic', requestId: 'r1', label: 'Uony está preparando tu respuesta…' },
    provisionalReply: null });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('el texto crece mientras Uony escribe y la respuesta definitiva lo sustituye sin repetirlo', () => {
  const view = mount();
  const epoch = useWorkspaceStore.getState().historyEpoch;
  act(() => showDurableProgress(ACCOUNT, epoch, running('Tu carpeta principal', 1)));
  expect(view.container.querySelector('.message.assistant.is-writing')?.textContent).toBe('Tu carpeta principal');
  expect(view.container.querySelector('.is-writing .uony-writing-caret')).toBeInTheDocument();
  act(() => showDurableProgress(ACCOUNT, epoch, running('Tu carpeta principal se llama Uonify.', 2)));
  expect(view.container.querySelector('.is-writing')?.textContent).toBe('Tu carpeta principal se llama Uonify.');
  act(() => settleDurableRequest(ACCOUNT, epoch, { requestId: 'r1', threadId: 'basic', status: 'success',
    response: { reply: 'Tu carpeta principal se llama Uonify. Dentro hay tres carpetas.', model: 'gemini-3.5-flash', effort: 'medium' } }));
  expect(view.container.querySelector('.is-writing')).toBeNull();
  expect(screen.getByText('Tu carpeta principal se llama Uonify. Dentro hay tres carpetas.')).toBeInTheDocument();
  expect(useUiStore.getState().provisionalReply).toBeNull();
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.role === 'assistant')).toHaveLength(1);
});

it('si falla a mitad, el texto a medias desaparece y Uony lo dice en la conversación', () => {
  const view = mount();
  const epoch = useWorkspaceStore.getState().historyEpoch;
  act(() => showDurableProgress(ACCOUNT, epoch, running('He leído los dos documentos de la carpeta', 1)));
  expect(view.container.querySelector('.is-writing')).toBeInTheDocument();
  act(() => settleDurableRequest(ACCOUNT, epoch, { requestId: 'r1', threadId: 'basic', status: 'error',
    error: { code: 'google_unavailable', message: 'No he podido terminar esto ahora mismo. ¿Lo intento de nuevo?' } }));
  expect(view.container.querySelector('.is-writing')).toBeNull();
  expect(screen.queryByText('He leído los dos documentos de la carpeta')).not.toBeInTheDocument();
  expect(screen.getByText('No he podido terminar esto ahora mismo. ¿Lo intento de nuevo?')).toBeInTheDocument();
});

it('una herramienta retira el texto y solo se pinta el de la petición en curso', () => {
  const view = mount();
  const epoch = useWorkspaceStore.getState().historyEpoch;
  act(() => showDurableProgress(ACCOUNT, epoch, running('Voy a mirar tus carpetas de Drive ahora mismo.', 1)));
  act(() => showDurableProgress(ACCOUNT, epoch, { requestId: 'r1', threadId: 'basic', status: 'running',
    progress: { stage: 'consulting_google', seq: 20 } }));
  expect(view.container.querySelector('.is-writing')).toBeNull();
  act(() => showDurableProgress(ACCOUNT, epoch, { ...running('Otra petición', 3), requestId: 'r2' }));
  expect(view.container.querySelector('.is-writing')).toBeNull();
});

it(`mientras Uony consulta a Google o escribe se lee cada ${LIVE_TEXT_POLL_MS} ms; en espera, cada segundo`, async () => {
  vi.useFakeTimers();
  const reads: number[] = [];
  const replies: DurableRequest[] = [
    { requestId: 'r1', threadId: 'basic', status: 'queued', progress: { stage: 'queued', seq: 1 } },
    running('Tu carpeta', 1),
    { requestId: 'r1', threadId: 'basic', status: 'success', response: { reply: 'Tu carpeta.', model: 'gemini-3.5-flash', effort: 'medium' } },
  ];
  vi.spyOn(api, 'get').mockImplementation(async () => { reads.push(Date.now()); return replies.shift()!; });
  const settled = vi.fn();
  watchDurableRequest({ account: ACCOUNT, epoch: 0, requestId: 'r1', threadId: 'basic', valid: () => true, settled });
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(999);
  expect(reads).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(reads).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(LIVE_TEXT_POLL_MS);
  expect(reads).toHaveLength(3);
  expect(settled).toHaveBeenCalledOnce();
});
