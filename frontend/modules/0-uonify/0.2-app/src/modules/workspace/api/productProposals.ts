import { api } from '@/shared/api/client';
import { productProposalOf, type ProductProposal } from '../model/productProposal';

export type ProductProposalDecision = 'approve' | 'reject' | 'cancel';

export interface ProductProposalReceipt {
  proposalId: string;
  requestId: string;
  status: 'approved' | 'rejected' | 'cancelled';
  linkedProduct: { sku: string; revision: number; version: number } | null;
  productChanges: import('@/shared/pim').ProductChange[];
}

export type ProductProposalDecisionRead =
  | { state: 'pending'; proposal: ProductProposal }
  | { state: 'confirmed'; proposal: ProductProposal; receipt: ProductProposalReceipt }
  | { state: 'unverified'; proposal: ProductProposal }
  | { state: 'decided_elsewhere'; proposal: ProductProposal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const productId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function receiptChanges(value: unknown, proposal: ProductProposal,
  status: ProductProposalReceipt['status'], linkedProduct: unknown): value is ProductProposalReceipt['productChanges'] {
  if (!Array.isArray(value)) return false;
  if (status !== 'approved') return value.length === 0 && linkedProduct === null;
  if (value.length !== 1 || !isRecord(value[0]) || !isRecord(value[0].product)
    || !isRecord(linkedProduct)) return false;
  const { product, previousSku } = value[0];
  return product.sku === proposal.targetSku && typeof product.name === 'string'
    && product.name.trim().length > 0
    && typeof product.id === 'string' && productId.test(product.id)
    && typeof product.revision === 'number'
    && Number.isSafeInteger(product.revision) && product.revision >= 1
    && (proposal.action === 'create' ? previousSku === null
      : previousSku === proposal.targetSku && product.id === proposal.targetProductId
        && product.revision > (proposal.baseRevision ?? 0))
    && linkedProduct.sku === product.sku && linkedProduct.revision === product.revision
    && typeof linkedProduct.version === 'number' && Number.isSafeInteger(linkedProduct.version)
    && linkedProduct.version >= 1;
}

const decidedStatus: Record<ProductProposalDecision, ProductProposalReceipt['status']> = {
  approve: 'approved', reject: 'rejected', cancel: 'cancelled',
};
const actionForStatus: Record<ProductProposalReceipt['status'], ProductProposalDecision> = {
  approved: 'approve', rejected: 'reject', cancelled: 'cancel',
};

function receiptOf(value: unknown, proposal: ProductProposal,
  action: ProductProposalDecision, requestId: string): ProductProposalReceipt | null {
  if (!isRecord(value)) return null;
  const expected = decidedStatus[action];
  if (value.proposalId !== proposal.proposalId || value.requestId !== requestId
    || value.status !== expected
    || !receiptChanges(value.productChanges, proposal, expected, value.linkedProduct)) return null;
  return value as unknown as ProductProposalReceipt;
}

async function loadProductProposal(proposalId: string, threadId: string,
  signal?: AbortSignal): Promise<{ proposal: ProductProposal; raw: Record<string, unknown> }> {
  const result = await api.get<unknown>(`/uony/product-proposals/${encodeURIComponent(proposalId)}`
    + `?threadId=${encodeURIComponent(threadId)}`, { signal });
  const proposal = productProposalOf(result, 'assistant');
  if (!proposal || proposal.proposalId !== proposalId || proposal.threadId !== threadId || !isRecord(result)) {
    throw new Error('No hemos podido comprobar la propuesta actual. Vuelve a consultarla.');
  }
  return { proposal, raw: result };
}

/** Always re-read the owner-bound proposal before asking for a decision. */
export async function getProductProposal(proposalId: string, threadId: string,
  signal?: AbortSignal): Promise<ProductProposal> {
  return (await loadProductProposal(proposalId, threadId, signal)).proposal;
}

/** A pending GET after a lost POST is inconclusive; never mint a new decision ID from it. */
export async function readProductProposalDecision(proposalId: string, threadId: string,
  action: ProductProposalDecision, requestId: string,
  signal?: AbortSignal): Promise<ProductProposalDecisionRead> {
  const { proposal, raw } = await loadProductProposal(proposalId, threadId, signal);
  if (proposal.status === 'pending') return { state: 'pending', proposal };
  const receipt = receiptOf(raw.decision, proposal, action, requestId);
  if (receipt && proposal.status === receipt.status) return { state: 'confirmed', proposal, receipt };
  if (isRecord(raw.decision) && typeof raw.decision.requestId === 'string'
    && raw.decision.requestId !== requestId
    && receiptOf(raw.decision, proposal, actionForStatus[proposal.status], raw.decision.requestId)) {
    return { state: 'decided_elsewhere', proposal };
  }
  return { state: 'unverified', proposal };
}

/** The caller owns a stable requestId; a lost response must be reconciled by GET. */
export async function decideProductProposal(proposal: ProductProposal,
  action: ProductProposalDecision, requestId: string): Promise<ProductProposalReceipt> {
  const result = await api.post<unknown>(`/uony/product-proposals/${encodeURIComponent(proposal.proposalId)}/decision`, {
    threadId: proposal.threadId, requestId, proposalHash: proposal.proposalHash,
    baseRevision: proposal.baseRevision, action,
  });
  const receipt = receiptOf(result, proposal, action, requestId);
  if (!receipt) throw new Error('No hemos podido confirmar el estado de la propuesta.');
  return receipt;
}
