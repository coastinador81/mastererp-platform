import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { ConversationFollowUpCards } from '../components/ConversationFollowUpCards';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'pilot@example.test' }));

const assignment = { assignment: { id: '11111111-1111-4111-8111-111111111111',
  label: 'Producto en Amazon', status: 'pending', nextStep: 'clarify_source', version: 1 },
  product: null, assignmentWork: null, relatedProductWork: null };
const noProduct = { product: null, confirmedFacts: [], status: null, pending: [],
  completedFollowUps: [], followUpHistory: [], trackingVersion: 0,
  sourceFingerprint: null, nextAction: 'continue_in_chat', summary: '' };

function showQuestion(question: string, focused = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? { resolution: focused ? 'focused' : 'single', focusVersion: focused ? 1 : 0,
      assignments: [assignment], moreAvailable: false } as never
    : { returnBrief: noProduct } as never);
  useWorkspaceStore.setState({ historyAccount: 'pilot@example.test', activeThreadId: 'new-drive-thread',
    threads: [{ id: 'new-drive-thread', title: 'Nuevo hilo', projectId: '4265517a-e5a2-4b3a-8fe1-54922bc3c5ad',
      service: null, view: 'default', messages: [{ role: 'user', text: question }] }] });
  render(<QueryClientProvider client={client}><ConversationFollowUpCards
    account="pilot@example.test" threadId="new-drive-thread" suspended={false} /></QueryClientProvider>);
  return { get, client };
}

beforeEach(() => { resetWorkspaceStore(); setUi({ pendingReply: null }); });
afterEach(() => vi.restoreAllMocks());

it.each(['Una pregunta, ¿tienes acceso a mi Drive?', '¿Qué productos tengo en Drive?', 'Muéstrame mis productos'])(
  'no inserta un encargo de Amazon por la consulta «%s»', async question => {
    const { get, client } = showQuestion(question);
    await waitFor(() => expect(get.mock.calls.some(([path]) => path.endsWith('/assignment-return'))).toBe(true));
    await waitFor(() => expect(client.getQueryData(['uony-assignment-return', 'pilot@example.test',
      'new-drive-thread', useWorkspaceStore.getState().historyRevision])).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument();
    expect(screen.queryByText('Producto en Amazon')).not.toBeInTheDocument();
  });

it('sí ofrece el encargo cuando la persona pide retomarlo', async () => {
  showQuestion('Quiero retomar mi encargo de producto');
  expect(await screen.findByRole('region', { name: 'Tus encargos guardados' })).toHaveTextContent('Producto en Amazon');
});

it.each(['Retoma mi encargo de análisis de Drive', 'Retoma mi producto de Drive'])(
  'permite la reanudación explícita «%s»', async question => {
    showQuestion(question);
    expect(await screen.findByRole('region', { name: 'Tus encargos guardados' })).toHaveTextContent('Producto en Amazon');
  });

it('abre la selección tras responder a una petición explícita de retomar, no durante la espera', async () => {
  const { client } = showQuestion('¿Tienes acceso a mi Drive?');
  await waitFor(() => expect(client.getQueryData(['uony-assignment-return', 'pilot@example.test',
    'new-drive-thread', useWorkspaceStore.getState().historyRevision])).toBeTruthy());
  act(() => {
    useWorkspaceStore.getState().pushMessage('new-drive-thread', { role: 'user', text: 'Retoma mi encargo de producto' });
    setUi({ pendingReply: { threadId: 'new-drive-thread', requestId: 'resume-request', label: 'Preparando…' } });
  });
  expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument();
  act(() => setUi({ pendingReply: null }));
  expect(await screen.findByRole('region', { name: 'Tus encargos guardados' })).toHaveTextContent('Producto en Amazon');
});

it('conserva el encargo ya enfocado en el mismo hilo al preguntar después por Drive', async () => {
  showQuestion('¿Tienes acceso a mi Drive?', true);
  expect(await screen.findByRole('region', { name: 'Tus encargos guardados' })).toHaveTextContent('Producto en Amazon');
});
