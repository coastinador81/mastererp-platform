import { api, ApiError } from '@/shared/api/client';
import { currentAccountEmail } from '@/modules/auth';

export interface ConfirmedFact {
  id: string;
  label: string;
  value: string;
  freshness: string;
}

export type AmazonPublicationPhase = 'not_started' | 'local_draft' | 'approved_not_sent'
  | 'reserved' | 'rejected_initial' | 'outcome_unknown' | 'awaiting_amazon' | 'checking'
  | 'check_failed' | 'visibility_check_stale' | 'not_found' | 'listing_present'
  | 'issues' | 'unmatched' | 'visible_current';

export interface AmazonPublicationDetail {
  phase: AmazonPublicationPhase;
  snapshotId: string | null;
  approvalId: string | null;
  attemptId: string | null;
  productRevision: number | null;
  matchesProductRevision: boolean;
  newerLocalDraft: boolean;
  currentVisibilityVerified: boolean;
  retailLinkVerified: false;
  causedByThisSubmission: null;
  submissionStatus?: string;
  lastCheckedAt?: string | null;
}

export interface ReturnBrief {
  product: null | { sku: string; name: string; revision: number; linkVersion?: number };
  confirmedFacts: ConfirmedFact[];
  status: null | { amazonRequirements: string; reasoning?: 'none' | 'queued' | 'running' | 'completed' | 'error' | 'unknown' | 'stale';
    reasoningDetail?: { id: string; status: 'queued' | 'running' | 'completed' | 'error' | 'unknown' | 'stale';
      message: string; canRetry: boolean; revision: number; connectionRequired: boolean;
      previousConnectionFailure?: boolean; requiresConsumptionAcknowledgement: boolean } | null;
    preparation?: 'not_started' | 'needs_review' | 'saved_without_pending'; material?: string;
    amazonPublication?: AmazonPublicationPhase;
    amazonPublicationDetail?: AmazonPublicationDetail };
  pending: { id: string; kind: string; label: string; sourceFingerprint: string;
    followUp: 'open' | 'deferred' }[];
  completedFollowUps: { id: string; label: string; canResolve: boolean }[];
  followUpHistory: { action: 'defer' | 'resolve'; pendingId: string; label: string;
    version: number; at: string }[];
  trackingVersion: number;
  sourceFingerprint: string | null;
  nextAction: string;
  summary: string;
}

export type ReturnFollowUpAction = 'defer' | 'resolve';

export interface ReturnFollowUpIntent {
  account: string;
  threadId: string;
  requestId: string;
  action: ReturnFollowUpAction;
  pendingId: string;
  expectedVersion: number;
  productRevision: number;
  sourceFingerprint: string;
}

export interface ReturnFollowUpEvent {
  requestId: string;
  action: ReturnFollowUpAction;
  pendingId: string;
  trackingVersion: number;
}

export type ReturnFollowUpResult = { kind: 'applied'; event: ReturnFollowUpEvent }
  | { kind: 'conflict'; code: string };

const fingerprint = /^[0-9a-f]{64}$/;
const pendingId = /^[a-z_]+:[A-Za-z0-9_-]+$/;

function validPending(value: ReturnBrief['pending'][number]): boolean {
  return !!value && typeof value.id === 'string' && pendingId.test(value.id)
    && typeof value.kind === 'string' && typeof value.label === 'string'
    && typeof value.sourceFingerprint === 'string' && fingerprint.test(value.sourceFingerprint)
    && ['open', 'deferred'].includes(value.followUp);
}

function validCompleted(value: ReturnBrief['completedFollowUps'][number]): boolean {
  return !!value && typeof value.id === 'string' && pendingId.test(value.id)
    && typeof value.label === 'string' && value.canResolve === true;
}

function validHistory(value: ReturnBrief['followUpHistory'][number]): boolean {
  return !!value && ['defer', 'resolve'].includes(value.action)
    && typeof value.pendingId === 'string' && pendingId.test(value.pendingId)
    && typeof value.label === 'string' && Number.isSafeInteger(value.version)
    && value.version > 0 && typeof value.at === 'string' && !!value.at;
}

function validReasoningDetail(value: NonNullable<ReturnBrief['status']>['reasoningDetail']): boolean {
  return value === undefined || value === null || (typeof value.id === 'string'
    && ['queued', 'running', 'completed', 'error', 'unknown', 'stale'].includes(value.status)
    && typeof value.message === 'string' && typeof value.canRetry === 'boolean'
    && typeof value.connectionRequired === 'boolean'
    && (value.previousConnectionFailure === undefined || typeof value.previousConnectionFailure === 'boolean')
    && typeof value.requiresConsumptionAcknowledgement === 'boolean'
    && Number.isSafeInteger(value.revision) && value.revision > 0);
}

export interface AmazonSnapshot {
  snapshotId: string;
  sku: string;
  productRevision: number;
  preview: {
    title: string | null;
    attributes: Record<string, unknown>;
    localIssues: { message?: string }[];
    localValidation: 'valid' | 'needs_input';
    mediaReadiness: 'missing' | 'unverified' | 'invalid';
    sourceCurrent: boolean;
    readyToSubmit: boolean;
    limitations: string[];
  };
}

export async function getReturnBrief(threadId: string, signal?: AbortSignal): Promise<ReturnBrief> {
  const result = await api.get<{ returnBrief?: ReturnBrief }>(`/uony/threads/${encodeURIComponent(threadId)}/return-brief`, { signal });
  const brief = result?.returnBrief;
  if (!brief || !Array.isArray(brief.confirmedFacts) || !Array.isArray(brief.pending)
    || !brief.pending.every(validPending) || !Array.isArray(brief.completedFollowUps)
    || !brief.completedFollowUps.every(validCompleted) || !Array.isArray(brief.followUpHistory)
    || !brief.followUpHistory.every(validHistory) || !Number.isSafeInteger(brief.trackingVersion)
    || brief.trackingVersion < 0
    || (brief.product === null ? brief.sourceFingerprint !== null
      : typeof brief.sourceFingerprint !== 'string' || !fingerprint.test(brief.sourceFingerprint))
    || typeof brief.summary !== 'string' || typeof brief.nextAction !== 'string'
    || (brief.status !== null && (!brief.status || typeof brief.status.amazonRequirements !== 'string'
      || !validReasoningDetail(brief.status.reasoningDetail)))
    || (brief.product !== null && (!brief.product || typeof brief.product.sku !== 'string'
      || typeof brief.product.name !== 'string' || !Number.isSafeInteger(brief.product.revision)
      || (brief.product.linkVersion !== undefined && (!Number.isSafeInteger(brief.product.linkVersion)
        || brief.product.linkVersion < 0))))) {
    throw new Error('No hemos podido recuperar el resumen de esta ficha.');
  }
  return brief;
}

/** El UUID se crea una vez por decisión y se conserva para cualquier reenvío. */
export function createReturnFollowUpIntent(account: string, threadId: string, brief: ReturnBrief,
  action: ReturnFollowUpAction, targetId: string): ReturnFollowUpIntent {
  if (!account || !threadId || !brief.product || !brief.sourceFingerprint
    || !fingerprint.test(brief.sourceFingerprint) || !Number.isSafeInteger(brief.trackingVersion)
    || brief.trackingVersion < 0 || !pendingId.test(targetId)) {
    throw new Error('Actualiza el resumen antes de gestionar este seguimiento.');
  }
  const target = action === 'defer'
    ? brief.pending.find(item => item.id === targetId && item.followUp === 'open')
    : brief.completedFollowUps.find(item => item.id === targetId && item.canResolve);
  if (!target) throw new Error('Este asunto ya no está disponible en el resumen actual.');
  return { account, threadId, requestId: crypto.randomUUID(), action, pendingId: targetId,
    expectedVersion: brief.trackingVersion, productRevision: brief.product.revision,
    sourceFingerprint: brief.sourceFingerprint };
}

function ensureCurrent(intent: ReturnFollowUpIntent, signal?: AbortSignal): void {
  if (signal?.aborted || currentAccountEmail() !== intent.account) {
    throw new DOMException('La sesión ha cambiado.', 'AbortError');
  }
}

/** El conflicto no cambia datos locales; la siguiente decisión exige un GET nuevo. */
export async function postReturnFollowUp(intent: ReturnFollowUpIntent,
  signal?: AbortSignal): Promise<ReturnFollowUpResult> {
  ensureCurrent(intent, signal);
  const { requestId, action, pendingId: targetId, expectedVersion, productRevision, sourceFingerprint } = intent;
  try {
    const response = await api.post<{ event?: ReturnFollowUpEvent }>(
      `/uony/threads/${encodeURIComponent(intent.threadId)}/return-brief/follow-up`,
      { requestId, action, pendingId: targetId, expectedVersion, productRevision, sourceFingerprint }, { signal });
    ensureCurrent(intent, signal);
    const event = response?.event;
    if (!event || event.requestId !== requestId || event.action !== action || event.pendingId !== targetId
      || event.trackingVersion !== expectedVersion + 1) {
      throw new Error('No hemos podido comprobar que el seguimiento se haya guardado.');
    }
    return { kind: 'applied', event };
  } catch (failure) {
    ensureCurrent(intent, signal);
    if (failure instanceof ApiError && failure.status === 409) {
      const data = failure.data as { error?: unknown; detail?: { error?: unknown } } | null;
      const code = data?.error ?? data?.detail?.error;
      return { kind: 'conflict', code: typeof code === 'string' ? code : 'return_brief_conflict' };
    }
    throw failure;
  }
}

function checkedSnapshot(value: AmazonSnapshot): AmazonSnapshot {
  if (!value || typeof value.snapshotId !== 'string' || typeof value.sku !== 'string'
    || !Number.isSafeInteger(value.productRevision) || !value.preview
    || typeof value.preview.sourceCurrent !== 'boolean' || typeof value.preview.readyToSubmit !== 'boolean'
    || !Array.isArray(value.preview.localIssues) || !Array.isArray(value.preview.limitations)
    || !value.preview.attributes || typeof value.preview.attributes !== 'object') {
    throw new Error('La vista previa guardada de Amazon no ha respondido correctamente.');
  }
  return value;
}

export async function getLatestAmazonSnapshot(sku: string, signal?: AbortSignal): Promise<AmazonSnapshot> {
  return checkedSnapshot(await api.get<AmazonSnapshot>(`/products/${encodeURIComponent(sku)}/amazon-publish-snapshots/latest`, { signal }));
}

/** Preparación local y explícita; nunca hace un envío a Amazon. */
export async function prepareAmazonSnapshot(sku: string, revision: number, signal?: AbortSignal): Promise<AmazonSnapshot> {
  return checkedSnapshot(await api.post<AmazonSnapshot>(`/products/${encodeURIComponent(sku)}/amazon-publish-snapshots`, { revision }, { signal }));
}
