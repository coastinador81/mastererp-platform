import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { api } from '@/shared/api/client';
import { ConversationProductProposal } from '../components/ConversationProductProposal';
import { ConversationMessages } from '../components/ConversationMessages';
import { readProductProposalDecisionIntent } from '../api/productProposalDecisionIntent';
import type { ProductProposalReceipt } from '../api/productProposals';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import type { ProductProposal } from '../model/productProposal';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'seller@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  useSession: () => ({ status: 'ready', user: { email: identity.account } }) }));

const account = 'seller@example.test';
const threadId = 'basic-mini-bricks';
const proposal: ProductProposal = {
  proposalId: '11111111-1111-4111-8111-111111111111', threadId,
  action: 'create', targetSku: 'BASIC-MINI-BRICKS-01', targetProductId: null,
  baseRevision: null, payload: { sku: 'BASIC-MINI-BRICKS-01', name: 'Basic Mini Bricks' },
  threadLinkVersion: 0, proposalHash: 'a'.repeat(64), status: 'pending',
  createdAt: '2026-10-17T10:00:00+00:00',
};
const product = {
  id: '44444444-4444-4444-8444-444444444444', sku: proposal.targetSku,
  name: 'Basic Mini Bricks', revision: 1,
};
const scope = { account, threadId, proposalId: proposal.proposalId };

function receipt(action: 'approve' | 'reject', requestId: string) {
  return {
    proposalId: proposal.proposalId, requestId,
    status: action === 'approve' ? 'approved' as const : 'rejected' as const,
    linkedProduct: action === 'approve' ? { sku: product.sku, revision: 1, version: 1 } : null,
    productChanges: action === 'approve' ? [{ product, previousSku: null }] : [],
  };
}

function View({ onConfirmed = vi.fn(), selectedAccount = account,
  selectedThread = threadId }: {
  onConfirmed?: (value: ProductProposalReceipt) => void;
  selectedAccount?: string; selectedThread?: string;
}) {
  return <ConversationProductProposal account={selectedAccount} threadId={selectedThread}
    proposal={proposal} originalText="He preparado Basic Mini Bricks para tu revisión."
    onConfirmed={onConfirmed} />;
}

beforeEach(() => {
  localStorage.clear();
  identity.account = account;
  resetWorkspaceStore();
  useWorkspaceStore.setState({
    activeThreadId: threadId, historyAccount: account,
    threads: [{ id: threadId, title: 'Basic Mini Bricks', service: null, view: 'default',
      messages: [{ role: 'assistant', text: 'Revisa Basic Mini Bricks.', productProposal: proposal }] }],
  });
});
afterEach(() => vi.restoreAllMocks());

it('relee una propuesta pendiente y muestra su alcance antes de ofrecer la decisión', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const post = vi.spyOn(api, 'post');
  render(<View />);
  const card = await screen.findByRole('region', { name: 'Propuesta de ficha' });
  expect(card).toHaveTextContent('Crear borrador · Basic Mini Bricks');
  expect(card).toHaveTextContent('No se analizarán archivos ni se publicará en Amazon');
  expect(screen.getByRole('button', { name: 'Crear borrador' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Descartar propuesta' })).toBeEnabled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledWith(expect.stringContaining(proposal.proposalId), expect.any(Object));
  expect(post).not.toHaveBeenCalled();
});

it('descartar con recibo confirmado cierra la tarjeta y sigue cerrada al remontar', async () => {
  let server = { ...proposal, decision: null as ReturnType<typeof receipt> | null };
  vi.spyOn(api, 'get').mockImplementation(async () => server);
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const input = body as { action: 'approve' | 'reject'; requestId: string };
    expect(input.action).toBe('reject');
    const result = receipt(input.action, input.requestId);
    server = { ...server, status: 'rejected', decision: result };
    return result;
  });
  const onConfirmed = vi.fn();
  const view = render(<View onConfirmed={onConfirmed} />);
  await screen.findByRole('region', { name: 'Propuesta de ficha' });
  fireEvent.click(screen.getByRole('button', { name: 'Descartar propuesta' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Propuesta de ficha' })).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('No se ha creado ninguna ficha');
  expect(onConfirmed).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledTimes(1);
  expect(readProductProposalDecisionIntent(scope)).toBeNull();
  view.unmount();
  render(<View onConfirmed={onConfirmed} />);
  await screen.findByText(/descarté la propuesta/);
  expect(screen.queryByRole('region', { name: 'Propuesta de ficha' })).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1);
});

it('aprobar con recibo confirmado cierra la tarjeta y comunica el producto guardado', async () => {
  let server = { ...proposal, decision: null as ReturnType<typeof receipt> | null };
  vi.spyOn(api, 'get').mockImplementation(async () => server);
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const input = body as { action: 'approve' | 'reject'; requestId: string };
    expect(input.action).toBe('approve');
    const result = receipt(input.action, input.requestId);
    server = { ...server, status: 'approved', decision: result };
    return result;
  });
  const onConfirmed = vi.fn();
  render(<View onConfirmed={onConfirmed} />);
  await screen.findByRole('region', { name: 'Propuesta de ficha' });
  fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Propuesta de ficha' })).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('guardé el borrador de Basic Mini Bricks');
  expect(onConfirmed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    status: 'approved', productChanges: [{ product, previousSku: null }],
  }));
  expect(post).toHaveBeenCalledTimes(1);
});

it('la conversación comunica a Producto el cambio solo tras confirmar el recibo', async () => {
  let server = { ...proposal, decision: null as ReturnType<typeof receipt> | null };
  vi.spyOn(api, 'get').mockImplementation(async () => server);
  vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const input = body as { action: 'approve' | 'reject'; requestId: string };
    const result = receipt(input.action, input.requestId);
    server = { ...server, status: 'approved', decision: result };
    return result;
  });
  const changed = vi.fn();
  window.addEventListener('uonify:products-changed', changed);
  try {
    render(<MemoryRouter initialEntries={['/espacio']}>
      <QueryClientProvider client={new QueryClient()}>
        <ConversationMessages centredInService={false} />
      </QueryClientProvider>
    </MemoryRouter>);
    await screen.findByRole('region', { name: 'Propuesta de ficha' });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual([{ product, previousSku: null }]);
    expect(screen.queryByRole('region', { name: 'Propuesta de ficha' })).not.toBeInTheDocument();
  } finally {
    window.removeEventListener('uonify:products-changed', changed);
  }
});

it('un POST incierto conserva el UUID y permite solo consultas GET, incluso tras remontar', async () => {
  let server = { ...proposal, decision: null as ReturnType<typeof receipt> | null };
  const get = vi.spyOn(api, 'get').mockImplementation(async () => server);
  const post = vi.spyOn(api, 'post').mockRejectedValue(new TypeError('Se perdió la respuesta'));
  const onConfirmed = vi.fn();
  const view = render(<View onConfirmed={onConfirmed} />);
  await screen.findByRole('region', { name: 'Propuesta de ficha' });
  fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
  await screen.findByRole('button', { name: 'Comprobar estado' });
  const requestId = readProductProposalDecisionIntent(scope)?.requestId;
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(readProductProposalDecisionIntent(scope)?.phase).toBe('submitted');
  fireEvent.click(screen.getByRole('button', { name: 'Comprobar estado' }));
  await screen.findByRole('button', { name: 'Comprobar estado' });
  expect(readProductProposalDecisionIntent(scope)?.requestId).toBe(requestId);
  expect(post).toHaveBeenCalledTimes(1);
  expect(onConfirmed).not.toHaveBeenCalled();
  view.unmount();
  render(<View onConfirmed={onConfirmed} />);
  await screen.findByRole('button', { name: 'Comprobar estado' });
  expect(post).toHaveBeenCalledTimes(1);
  server = { ...server, status: 'approved', decision: receipt('approve', requestId!) };
  fireEvent.click(screen.getByRole('button', { name: 'Comprobar estado' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Propuesta de ficha' })).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('guardé el borrador');
  expect(onConfirmed).toHaveBeenCalledOnce();
  expect(readProductProposalDecisionIntent(scope)).toBeNull();
  expect(post).toHaveBeenCalledTimes(1);
  expect(get.mock.calls.length).toBeGreaterThan(3);
});

it('no confirma una versión que cambió después de mostrarse la tarjeta', async () => {
  vi.spyOn(api, 'get').mockResolvedValueOnce(proposal)
    .mockResolvedValue({ ...proposal, proposalHash: 'b'.repeat(64) });
  const post = vi.spyOn(api, 'post');
  render(<View />);
  await screen.findByRole('region', { name: 'Propuesta de ficha' });
  fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
  await screen.findByRole('button', { name: 'Comprobar estado' });
  expect(readProductProposalDecisionIntent(scope)).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('una cuenta u otro hilo no puede decidir una tarjeta ajena', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const post = vi.spyOn(api, 'post');
  const view = render(<View />);
  await screen.findByRole('region', { name: 'Propuesta de ficha' });
  identity.account = 'other@example.test';
  fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
  expect(post).not.toHaveBeenCalled();
  identity.account = account;
  useWorkspaceStore.getState().setActiveThread('otro-hilo');
  fireEvent.click(screen.getByRole('button', { name: 'Descartar propuesta' }));
  expect(post).not.toHaveBeenCalled();
  view.unmount();
  render(<View selectedAccount="other@example.test" selectedThread="otro-hilo" />);
  expect(screen.queryByRole('region', { name: 'Propuesta de ficha' })).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
