import { productProposalForThread, productProposalOf } from '../model/productProposal';
import { restoreWorkspace } from '../model/workspaceState';
import { api } from '@/shared/api/client';
import { decideProductProposal, getProductProposal, readProductProposalDecision } from '../api/productProposals';

const proposal = {
  proposalId: '11111111-1111-4111-8111-111111111111',
  threadId: 'basic', action: 'create', targetSku: 'BASIC-01',
  targetProductId: null, baseRevision: null,
  payload: { sku: 'BASIC-01', name: 'Basic Mini Bricks' },
  threadLinkVersion: 0, proposalHash: 'a'.repeat(64),
  status: 'pending', createdAt: '2026-10-17T10:00:00+00:00',
};

it('conserva la propuesta persistida solo en una respuesta del asistente', () => {
  expect(productProposalOf({ ...proposal, execute: true }, 'assistant')).toEqual(proposal);
  expect(productProposalOf(proposal, 'user')).toBeUndefined();
  const restored = restoreWorkspace({ threads: [{ id: 'basic', title: 'Basic', messages: [
    { role: 'assistant', text: 'Revísala antes de guardar.', productProposal: proposal },
    { role: 'user', text: 'Quiero empezar.', productProposal: proposal },
  ] }] });
  expect(restored.threads[0].messages[0].productProposal).toEqual(proposal);
  expect(restored.threads[0].messages[1].productProposal).toBeUndefined();
  expect(productProposalForThread(proposal, 'assistant', 'other-thread')).toBeUndefined();
  const foreign = restoreWorkspace({ threads: [{ id: 'other-thread', title: 'Otro', messages: [
    { role: 'assistant', text: 'No es de este hilo.', productProposal: proposal },
  ] }] });
  expect(foreign.threads[0].messages[0].productProposal).toBeUndefined();
});

it('rechaza identidades, revisiones y firmas mal formadas antes de exponer la decisión', () => {
  for (const invalid of [
    { ...proposal, proposalId: '../other' }, { ...proposal, threadId: 'other/thread' },
    { ...proposal, proposalHash: 'short' }, { ...proposal, baseRevision: 1 },
    { ...proposal, targetProductId: '11111111-1111-4111-8111-111111111111' },
    { ...proposal, status: 'executed' }, { ...proposal, payload: [] },
    { ...proposal, action: 'update' },
  ]) expect(productProposalOf(invalid, 'assistant')).toBeUndefined();
  expect(productProposalOf({ ...proposal, action: 'update',
    targetProductId: '22222222-2222-4222-8222-222222222222', baseRevision: 2 }, 'assistant')?.baseRevision).toBe(2);
});

it('relee la propuesta y envía solo una decisión tipada con el UUID del cliente', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(proposal);
  const current = await getProductProposal(proposal.proposalId, proposal.threadId);
  expect(get).toHaveBeenCalledWith(`/uony/product-proposals/${proposal.proposalId}?threadId=basic`, { signal: undefined });
  const savedProduct = { id: '44444444-4444-4444-8444-444444444444',
    sku: 'BASIC-01', name: 'Basic Mini Bricks', revision: 1 };
  const approvedReceipt = { proposalId: proposal.proposalId,
    requestId: '33333333-3333-4333-8333-333333333333', status: 'approved',
    linkedProduct: { sku: 'BASIC-01', revision: 1, version: 1 },
    productChanges: [{ product: savedProduct, previousSku: null }] };
  const post = vi.spyOn(api, 'post').mockResolvedValue(approvedReceipt);
  await expect(decideProductProposal(current, 'approve', '33333333-3333-4333-8333-333333333333'))
    .resolves.toMatchObject({ status: 'approved' });
  expect(post).toHaveBeenCalledWith(`/uony/product-proposals/${proposal.proposalId}/decision`, {
    threadId: 'basic', requestId: '33333333-3333-4333-8333-333333333333',
    proposalHash: proposal.proposalHash, baseRevision: null, action: 'approve',
  });
  post.mockResolvedValueOnce({ proposalId: proposal.proposalId, requestId: 'other',
    status: 'approved', productChanges: [] });
  await expect(decideProductProposal(current, 'approve', '33333333-3333-4333-8333-333333333333'))
    .rejects.toThrow('confirmar el estado');
  post.mockResolvedValueOnce({ ...approvedReceipt, productChanges: [{ product: {}, previousSku: null }] });
  await expect(decideProductProposal(current, 'approve', '33333333-3333-4333-8333-333333333333'))
    .rejects.toThrow('confirmar el estado');
  post.mockResolvedValueOnce({ ...approvedReceipt, linkedProduct: null });
  await expect(decideProductProposal(current, 'approve', '33333333-3333-4333-8333-333333333333'))
    .rejects.toThrow('confirmar el estado');
  post.mockResolvedValueOnce({ ...approvedReceipt, productChanges: [{
    product: { ...savedProduct, id: 'otra-ficha' }, previousSku: null,
  }] });
  await expect(decideProductProposal(current, 'approve', '33333333-3333-4333-8333-333333333333'))
    .rejects.toThrow('confirmar el estado');
  post.mockResolvedValueOnce({ ...approvedReceipt, productChanges: [{
    product: { ...savedProduct, name: '  ' }, previousSku: null,
  }] });
  await expect(decideProductProposal(current, 'approve', '33333333-3333-4333-8333-333333333333'))
    .rejects.toThrow('confirmar el estado');
  get.mockResolvedValueOnce({ ...proposal, status: 'pending', decision: null });
  await expect(readProductProposalDecision(proposal.proposalId, 'basic', 'approve', approvedReceipt.requestId))
    .resolves.toMatchObject({ state: 'pending' });
  get.mockResolvedValueOnce({ ...proposal, status: 'approved', decision: approvedReceipt });
  await expect(readProductProposalDecision(proposal.proposalId, 'basic', 'approve', approvedReceipt.requestId))
    .resolves.toMatchObject({ state: 'confirmed', receipt: approvedReceipt });
  get.mockResolvedValueOnce({ ...proposal, status: 'approved', decision: approvedReceipt });
  await expect(readProductProposalDecision(proposal.proposalId, 'basic', 'approve', 'other-request'))
    .resolves.toMatchObject({ state: 'decided_elsewhere' });
  get.mockResolvedValueOnce({ ...proposal, status: 'approved', decision: { ...approvedReceipt, productChanges: [] } });
  await expect(readProductProposalDecision(proposal.proposalId, 'basic', 'approve', approvedReceipt.requestId))
    .resolves.toMatchObject({ state: 'unverified' });
  get.mockResolvedValueOnce({ ...proposal, status: 'approved', decision: {
    ...approvedReceipt, requestId: 'other-request', productChanges: [],
  } });
  await expect(readProductProposalDecision(proposal.proposalId, 'basic', 'approve', approvedReceipt.requestId))
    .resolves.toMatchObject({ state: 'unverified' });
  vi.restoreAllMocks();
});
