import { api } from '@/shared/api/client';
import { beginProductProposalDecision, readProductProposalDecisionIntent,
  reconcileProductProposalDecision, submitProductProposalDecision,
  type ProductProposalDecisionScope } from '../api/productProposalDecisionIntent';

const identity = vi.hoisted(() => ({ account: 'ana@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));

const scope: ProductProposalDecisionScope = {
  account: 'ana@example.test', threadId: 'basic',
  proposalId: '11111111-1111-4111-8111-111111111111',
};
const proposal = {
  proposalId: scope.proposalId, threadId: scope.threadId,
  action: 'create', targetSku: 'BASIC-01', targetProductId: null,
  baseRevision: null, payload: { sku: 'BASIC-01', name: 'Basic Mini Bricks' },
  threadLinkVersion: 0, proposalHash: 'a'.repeat(64), status: 'pending',
  createdAt: '2026-10-17T10:00:00+00:00', decision: null,
};
const savedProduct = { id: '44444444-4444-4444-8444-444444444444',
  sku: 'BASIC-01', name: 'Basic Mini Bricks', revision: 1 };

function receipt(requestId: string) {
  return { proposalId: scope.proposalId, requestId, status: 'approved',
    linkedProduct: { sku: 'BASIC-01', revision: 1, version: 1 },
    productChanges: [{ product: savedProduct, previousSku: null }] };
}

beforeEach(() => { localStorage.clear(); identity.account = scope.account; vi.restoreAllMocks(); });
afterEach(() => vi.restoreAllMocks());

it('relee en servidor, conserva un UUID por cuenta/hilo/propuesta y no sobreescribe otra decisión', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const post = vi.spyOn(api, 'post');
  const first = await beginProductProposalDecision(scope, 'approve', proposal.proposalHash);
  expect(first).toMatchObject({ ...scope, action: 'approve', phase: 'prepared', proposalHash: proposal.proposalHash });
  expect(first?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await beginProductProposalDecision(scope, 'approve', proposal.proposalHash)).toEqual(first);
  expect(await beginProductProposalDecision(scope, 'reject', proposal.proposalHash)).toBeNull();
  get.mockResolvedValueOnce({ ...proposal, proposalHash: 'b'.repeat(64) });
  expect(await beginProductProposalDecision(scope, 'approve', proposal.proposalHash)).toBeNull();
  expect(readProductProposalDecisionIntent(scope)).toEqual(first);
  expect(readProductProposalDecisionIntent({ ...scope, account: 'otra@example.test' })).toBeNull();
  expect(readProductProposalDecisionIntent({ ...scope, threadId: 'otro' })).toBeNull();
  expect(readProductProposalDecisionIntent({ ...scope, proposalId: '22222222-2222-4222-8222-222222222222' })).toBeNull();
  identity.account = 'otra@example.test';
  expect(await beginProductProposalDecision(scope, 'approve', proposal.proposalHash)).toBeNull();
  expect(get).toHaveBeenCalledTimes(4);
  expect(post).not.toHaveBeenCalled();
});

it('no reserva una aprobación si la propuesta cambió desde que el cliente la revisó', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...proposal, proposalHash: 'b'.repeat(64) });
  const post = vi.spyOn(api, 'post');
  expect(await beginProductProposalDecision(scope, 'approve', proposal.proposalHash)).toBeNull();
  expect(readProductProposalDecisionIntent(scope)).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('guarda submitted antes del POST y libera la reserva solo con el recibo validado', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const intent = (await beginProductProposalDecision(scope, 'approve', proposal.proposalHash))!;
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    expect(readProductProposalDecisionIntent(scope)?.phase).toBe('submitted');
    return receipt(intent.requestId);
  });
  const result = await submitProductProposalDecision(intent);
  expect(result).toMatchObject({ state: 'confirmed', receipt: receipt(intent.requestId) });
  expect(post).toHaveBeenCalledTimes(1);
  expect(readProductProposalDecisionIntent(scope)).toBeNull();
  expect(await submitProductProposalDecision(intent)).toEqual({ state: 'unavailable' });
  expect(post).toHaveBeenCalledTimes(1);
});

it('dos envíos concurrentes en la misma pestaña no duplican el POST', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const intent = (await beginProductProposalDecision(scope, 'approve', proposal.proposalHash))!;
  const post = vi.spyOn(api, 'post').mockResolvedValue(receipt(intent.requestId));
  const results = await Promise.all([
    submitProductProposalDecision(intent), submitProductProposalDecision(intent),
  ]);
  expect(post).toHaveBeenCalledTimes(1);
  expect(results.filter(result => result.state === 'confirmed')).toHaveLength(1);
});

it('tras perder el POST consulta el GET y nunca reenvía automáticamente el mismo UUID', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const intent = (await beginProductProposalDecision(scope, 'approve', proposal.proposalHash))!;
  const post = vi.spyOn(api, 'post').mockRejectedValue(new TypeError('offline'));
  expect(await submitProductProposalDecision(intent)).toMatchObject({ state: 'uncertain' });
  expect(readProductProposalDecisionIntent(scope)).toMatchObject({ requestId: intent.requestId, phase: 'submitted' });
  expect(await submitProductProposalDecision(intent)).toMatchObject({ state: 'uncertain' });
  expect(post).toHaveBeenCalledTimes(1);
  get.mockResolvedValueOnce({ ...proposal, status: 'approved', decision: receipt(intent.requestId) });
  expect(await reconcileProductProposalDecision(intent))
    .toMatchObject({ state: 'confirmed', receipt: receipt(intent.requestId) });
  expect(readProductProposalDecisionIntent(scope)).toBeNull();
  expect(post).toHaveBeenCalledTimes(1);
});

it('distingue otra decisión de un recibo ilegible, sin borrar el UUID ni declarar éxito', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const intent = (await beginProductProposalDecision(scope, 'approve', proposal.proposalHash))!;
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('respuesta perdida'));
  get.mockResolvedValueOnce(proposal);
  get.mockResolvedValueOnce({ ...proposal, status: 'rejected', decision: {
    proposalId: scope.proposalId, requestId: '33333333-3333-4333-8333-333333333333',
    status: 'rejected', linkedProduct: null, productChanges: [],
  } });
  expect(await submitProductProposalDecision(intent)).toMatchObject({ state: 'decided_elsewhere' });
  expect(readProductProposalDecisionIntent(scope)?.requestId).toBe(intent.requestId);
  get.mockResolvedValueOnce({ ...proposal, status: 'approved', decision: {
    ...receipt(intent.requestId), productChanges: [],
  } });
  expect(await reconcileProductProposalDecision(intent)).toMatchObject({ state: 'unverified' });
  expect(readProductProposalDecisionIntent(scope)?.requestId).toBe(intent.requestId);
  expect(post).toHaveBeenCalledTimes(1);
});

it('no envía nada si cambia la identidad o si la intención local queda ilegible', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const post = vi.spyOn(api, 'post').mockResolvedValue(null);
  const intent = (await beginProductProposalDecision(scope, 'approve', proposal.proposalHash))!;
  identity.account = 'otra@example.test';
  expect(await submitProductProposalDecision(intent)).toEqual({ state: 'unavailable' });
  identity.account = scope.account;
  localStorage.setItem('uonify:product-proposal-decision:v1:'
    + JSON.stringify([scope.account, scope.threadId, scope.proposalId]), '{');
  expect(await submitProductProposalDecision(intent)).toEqual({ state: 'unavailable' });
  expect(await beginProductProposalDecision(scope, 'approve', proposal.proposalHash)).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('una respuesta que llega tras cambiar de cuenta no se presenta como confirmación de la nueva cuenta', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const intent = (await beginProductProposalDecision(scope, 'approve', proposal.proposalHash))!;
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    identity.account = 'otra@example.test';
    return receipt(intent.requestId);
  });
  expect(await submitProductProposalDecision(intent)).toEqual({ state: 'unavailable' });
  expect(readProductProposalDecisionIntent(scope)).toMatchObject({ phase: 'submitted', requestId: intent.requestId });
  identity.account = scope.account;
  get.mockResolvedValueOnce({ ...proposal, status: 'approved', decision: receipt(intent.requestId) });
  expect(await reconcileProductProposalDecision(intent)).toMatchObject({ state: 'confirmed' });
  expect(post).toHaveBeenCalledTimes(1);
});

it('no envía una decisión si la propuesta cambió entre la revisión y el envío', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const post = vi.spyOn(api, 'post');
  const intent = (await beginProductProposalDecision(scope, 'approve', proposal.proposalHash))!;
  get.mockResolvedValueOnce({ ...proposal, proposalHash: 'b'.repeat(64) });
  expect(await submitProductProposalDecision(intent)).toMatchObject({ state: 'changed' });
  expect(readProductProposalDecisionIntent(scope)).toEqual(intent);
  expect(post).not.toHaveBeenCalled();
});

it('al llegar al límite de reservas no sustituye UUIDs inciertos', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const post = vi.spyOn(api, 'post');
  for (let index = 0; index < 128; index += 1) {
    localStorage.setItem(`uonify:product-proposal-decision:v1:${index}`, '{}');
  }
  expect(await beginProductProposalDecision(scope, 'approve', proposal.proposalHash)).toBeNull();
  expect(readProductProposalDecisionIntent(scope)).toBeNull();
  expect(get).toHaveBeenCalledTimes(1);
  expect(post).not.toHaveBeenCalled();
});
