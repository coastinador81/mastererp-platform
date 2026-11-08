import { currentAccountEmail } from '@/modules/auth';
import { decideProductProposal, getProductProposal, readProductProposalDecision,
  type ProductProposalDecision, type ProductProposalReceipt } from './productProposals';
import type { ProductProposal } from '../model/productProposal';

export interface ProductProposalDecisionScope {
  account: string;
  threadId: string;
  proposalId: string;
}

export interface ProductProposalDecisionIntent extends ProductProposalDecisionScope {
  proposalHash: string;
  baseRevision: number | null;
  action: ProductProposalDecision;
  requestId: string;
  phase: 'prepared' | 'submitted';
}

export type ProductProposalDecisionOutcome =
  | { state: 'confirmed'; receipt: ProductProposalReceipt; proposal: ProductProposal }
  | { state: 'pending' | 'uncertain' | 'changed' | 'decided_elsewhere' | 'unverified'; proposal: ProductProposal }
  | { state: 'unavailable' };

const prefix = 'uonify:product-proposal-decision:v1:';
const maxIntents = 128;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const thread = /^[A-Za-z0-9_-]{1,80}$/;
const keyFor = ({ account, threadId, proposalId }: ProductProposalDecisionScope) =>
  prefix + JSON.stringify([account, threadId, proposalId]);

function store(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

function activeAccount(account: string): boolean {
  return !!account && currentAccountEmail() === account;
}

function sameDecision(left: ProductProposalDecisionIntent, right: ProductProposalDecisionIntent): boolean {
  return left.account === right.account && left.threadId === right.threadId
    && left.proposalId === right.proposalId && left.proposalHash === right.proposalHash
    && left.baseRevision === right.baseRevision && left.action === right.action
    && left.requestId === right.requestId;
}

function matchesProposal(intent: ProductProposalDecisionIntent, proposal: ProductProposal): boolean {
  return intent.proposalId === proposal.proposalId && intent.threadId === proposal.threadId
    && intent.proposalHash === proposal.proposalHash && intent.baseRevision === proposal.baseRevision;
}

/** Solo se guardan identidad, decisión y UUID; nunca el contenido de la ficha. */
export function readProductProposalDecisionIntent(scope: ProductProposalDecisionScope): ProductProposalDecisionIntent | null {
  try {
    const raw = store()?.getItem(keyFor(scope));
    if (!raw) return null;
    const row = JSON.parse(raw) as Partial<ProductProposalDecisionIntent>;
    return row.account === scope.account && row.threadId === scope.threadId
      && row.proposalId === scope.proposalId && !!row.account
      && thread.test(row.threadId) && uuid.test(row.proposalId)
      && typeof row.proposalHash === 'string' && hash.test(row.proposalHash)
      && (row.baseRevision === null || (Number.isSafeInteger(row.baseRevision) && Number(row.baseRevision) >= 1))
      && (row.action === 'approve' || row.action === 'reject' || row.action === 'cancel')
      && typeof row.requestId === 'string' && uuid.test(row.requestId)
      && (row.phase === 'prepared' || row.phase === 'submitted')
      ? row as ProductProposalDecisionIntent : null;
  } catch { return null; }
}

/** La propuesta se relee desde el servidor antes de reservar un UUID de decisión. */
export async function beginProductProposalDecision(scope: ProductProposalDecisionScope,
  action: ProductProposalDecision, reviewedHash: string): Promise<ProductProposalDecisionIntent | null> {
  if (!activeAccount(scope.account)) return null;
  const proposal = await getProductProposal(scope.proposalId, scope.threadId);
  if (!activeAccount(scope.account) || proposal.proposalHash !== reviewedHash) return null;
  const previous = readProductProposalDecisionIntent(scope);
  if (previous) return matchesProposal(previous, proposal) && previous.action === action ? previous : null;
  const storage = store();
  if (!storage || proposal.status !== 'pending' || proposal.threadId !== scope.threadId) return null;
  try {
    // Un registro ilegible también bloquea otro UUID; no se sobreescribe una decisión incierta.
    if (storage.getItem(keyFor(scope)) !== null) return null;
    let count = 0;
    for (let index = 0; index < storage.length; index += 1) {
      if (storage.key(index)?.startsWith(prefix)) count += 1;
    }
    if (count >= maxIntents) return null;
    const intent: ProductProposalDecisionIntent = { ...scope,
      proposalHash: proposal.proposalHash, baseRevision: proposal.baseRevision,
      action, requestId: crypto.randomUUID(), phase: 'prepared' };
    storage.setItem(keyFor(scope), JSON.stringify(intent));
    const saved = readProductProposalDecisionIntent(scope);
    return saved && sameDecision(saved, intent) ? saved : null;
  } catch { return null; }
}

function markSubmitted(intent: ProductProposalDecisionIntent): boolean {
  const storage = store();
  const saved = readProductProposalDecisionIntent(intent);
  if (!storage || !saved || !sameDecision(saved, intent) || saved.phase !== 'prepared') return false;
  try {
    storage.setItem(keyFor(intent), JSON.stringify({ ...saved, phase: 'submitted' }));
    const updated = readProductProposalDecisionIntent(intent);
    return !!updated && sameDecision(updated, intent) && updated.phase === 'submitted';
  } catch { return false; }
}

function clearConfirmed(intent: ProductProposalDecisionIntent): void {
  const storage = store();
  if (!storage) return;
  const saved = readProductProposalDecisionIntent(intent);
  if (!saved || !sameDecision(saved, intent)) return;
  try { storage.removeItem(keyFor(intent)); }
  catch { /* El recibo del servidor sigue disponible para una próxima consulta. */ }
}

/** Consulta sin reenviar la decisión, incluso si el POST original sigue en curso. */
export async function reconcileProductProposalDecision(intent: ProductProposalDecisionIntent,
  signal?: AbortSignal): Promise<ProductProposalDecisionOutcome> {
  const saved = readProductProposalDecisionIntent(intent);
  if (!activeAccount(intent.account) || !saved || !sameDecision(saved, intent)) return { state: 'unavailable' };
  try {
    const read = await readProductProposalDecision(intent.proposalId, intent.threadId,
      intent.action, intent.requestId, signal);
    if (!activeAccount(intent.account)) return { state: 'unavailable' };
    if (!matchesProposal(intent, read.proposal)) return { state: 'changed', proposal: read.proposal };
    if (read.state === 'confirmed') {
      clearConfirmed(intent);
      return { state: 'confirmed', proposal: read.proposal, receipt: read.receipt };
    }
    if (read.state === 'pending' && saved.phase === 'submitted') {
      return { state: 'uncertain', proposal: read.proposal };
    }
    return read;
  } catch { return { state: 'unavailable' }; }
}

/** Un solo envío por intención local: tras una respuesta incierta, solo GET. */
export async function submitProductProposalDecision(intent: ProductProposalDecisionIntent):
  Promise<ProductProposalDecisionOutcome> {
  const saved = readProductProposalDecisionIntent(intent);
  if (!activeAccount(intent.account) || !saved || !sameDecision(saved, intent)) return { state: 'unavailable' };
  if (saved.phase === 'submitted') return reconcileProductProposalDecision(saved);
  const preflight = await reconcileProductProposalDecision(saved);
  if (preflight.state !== 'pending') return preflight;
  if (!activeAccount(intent.account) || !markSubmitted(saved)) return { state: 'unavailable' };
  try {
    const receipt = await decideProductProposal(preflight.proposal, intent.action, intent.requestId);
    if (!activeAccount(intent.account)) return { state: 'unavailable' };
    clearConfirmed(intent);
    return { state: 'confirmed', proposal: preflight.proposal, receipt };
  } catch {
    // Ni un timeout ni un 409 prueban que el servidor no guardó la decisión.
    return reconcileProductProposalDecision(intent);
  }
}
