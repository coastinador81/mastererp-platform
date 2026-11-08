export interface ProductProposal {
  proposalId: string;
  threadId: string;
  action: 'create' | 'update';
  targetSku: string;
  targetProductId: string | null;
  baseRevision: number | null;
  payload: Record<string, unknown>;
  threadLinkVersion: number;
  proposalHash: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdAt: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const sku = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const thread = /^[A-Za-z0-9_-]{1,80}$/;
const states = ['pending', 'approved', 'rejected', 'cancelled'];

/** A proposal is server data attached to an assistant turn, never an instruction. */
export function productProposalOf(value: unknown, role: unknown): ProductProposal | undefined {
  if (role !== 'assistant' || typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.proposalId !== 'string' || !uuid.test(row.proposalId)
    || typeof row.threadId !== 'string' || !thread.test(row.threadId)
    || (row.action !== 'create' && row.action !== 'update')
    || typeof row.targetSku !== 'string' || !sku.test(row.targetSku)
    || typeof row.proposalHash !== 'string' || !hash.test(row.proposalHash)
    || typeof row.createdAt !== 'string' || Number.isNaN(Date.parse(row.createdAt))
    || typeof row.threadLinkVersion !== 'number' || !Number.isSafeInteger(row.threadLinkVersion)
    || row.threadLinkVersion < 0 || !states.includes(row.status as string)
    || typeof row.payload !== 'object' || row.payload === null || Array.isArray(row.payload)) return undefined;
  if (row.action === 'create') {
    if (row.targetProductId !== null || row.baseRevision !== null) return undefined;
  } else if (typeof row.targetProductId !== 'string' || !uuid.test(row.targetProductId)
      || typeof row.baseRevision !== 'number' || !Number.isSafeInteger(row.baseRevision)
      || row.baseRevision < 1) return undefined;
  return {
    proposalId: row.proposalId, threadId: row.threadId,
    action: row.action, targetSku: row.targetSku,
    targetProductId: row.targetProductId as string | null,
    baseRevision: row.baseRevision as number | null,
    payload: row.payload as Record<string, unknown>,
    threadLinkVersion: row.threadLinkVersion,
    proposalHash: row.proposalHash, status: row.status as ProductProposal['status'],
    createdAt: row.createdAt,
  };
}

/** A proposal may only be attached to the assistant turn in its own thread. */
export function productProposalForThread(value: unknown, role: unknown,
  threadId: string): ProductProposal | undefined {
  const proposal = productProposalOf(value, role);
  return proposal?.threadId === threadId ? proposal : undefined;
}
