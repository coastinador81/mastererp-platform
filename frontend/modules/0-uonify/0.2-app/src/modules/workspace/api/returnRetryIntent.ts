/** Identidad local de un único retry estructurado. Nunca crea una segunda petición tras un timeout. */
import { api } from '@/shared/api/client';

export interface ReturnRetryIdentity {
  account: string;
  threadId: string;
  sku: string;
  revision: number;
  linkVersion: number;
  reasoningId: string;
  reasoningStatus: 'error' | 'unknown';
  sourceFingerprint: string;
}

export interface ReturnRetryIntent extends ReturnRetryIdentity {
  requestId: string;
  projectId: string | null;
  acknowledgeUnknown: boolean;
}

const prefix = 'uonify:return-retry:';
const keyFor = ({ account, threadId, sku }: Pick<ReturnRetryIdentity, 'account' | 'threadId' | 'sku'>) =>
  prefix + JSON.stringify([account, threadId, sku]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fingerprint = /^[0-9a-f]{64}$/;
const activeRequests = new Map<string, { account: string; threadId: string }>();
const retryConflicts = new Set<string>();
const threadKey = (account: string, threadId: string) => JSON.stringify([account, threadId]);

export function markReturnRetryConflict(account: string, threadId: string): void {
  retryConflicts.add(threadKey(account, threadId));
}

export function hasReturnRetryConflict(account: string, threadId: string): boolean {
  return retryConflicts.has(threadKey(account, threadId));
}

export function clearReturnRetryConflict(account: string, threadId: string): void {
  retryConflicts.delete(threadKey(account, threadId));
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  retryConflicts.clear(); activeRequests.clear();
});

/** Protege la tarjeta hasta que pendingReply se cierre, incluso si un 409 libera el UUID persistido. */
export function retainReturnRetryRequest(intent: ReturnRetryIntent): void {
  activeRequests.set(intent.requestId, { account: intent.account, threadId: intent.threadId });
}

export function releaseReturnRetryRequest(intent: ReturnRetryIntent): void {
  const active = activeRequests.get(intent.requestId);
  if (active?.account === intent.account && active.threadId === intent.threadId) activeRequests.delete(intent.requestId);
}

export function readReturnRetryIntent(identity: Pick<ReturnRetryIdentity, 'account' | 'threadId' | 'sku'>): ReturnRetryIntent | null {
  try {
    const raw = localStorage.getItem(keyFor(identity));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReturnRetryIntent>;
    return value.account === identity.account && value.threadId === identity.threadId && value.sku === identity.sku
      && typeof value.requestId === 'string' && uuid.test(value.requestId)
      && Number.isSafeInteger(value.revision) && Number(value.revision) > 0
      && Number.isSafeInteger(value.linkVersion) && Number(value.linkVersion) >= 0
      && typeof value.reasoningId === 'string' && uuid.test(value.reasoningId)
      && (value.reasoningStatus === 'error' || value.reasoningStatus === 'unknown')
      && typeof value.sourceFingerprint === 'string' && fingerprint.test(value.sourceFingerprint)
      && (value.projectId === null || typeof value.projectId === 'string')
      && typeof value.acknowledgeUnknown === 'boolean' ? value as ReturnRetryIntent : null;
  } catch { return null; }
}

export function sameReturnRetry(identity: ReturnRetryIdentity, intent: ReturnRetryIntent): boolean {
  return intent.account === identity.account && intent.threadId === identity.threadId
    && intent.sku === identity.sku && intent.revision === identity.revision
    && intent.linkVersion === identity.linkVersion
    && intent.reasoningId === identity.reasoningId && intent.reasoningStatus === identity.reasoningStatus
    && intent.sourceFingerprint === identity.sourceFingerprint;
}

/** Persistir y volver a leer antes de hacer POST: si falla storage, se detiene la operación. */
export function saveReturnRetryIntent(identity: ReturnRetryIdentity, projectId: string | null,
  acknowledgeUnknown: boolean): ReturnRetryIntent | null {
  const previous = readReturnRetryIntent(identity);
  if (previous) return sameReturnRetry(identity, previous) ? previous : null;
  try { if (localStorage.getItem(keyFor(identity)) !== null) return null; } catch { return null; }
  if (!fingerprint.test(identity.sourceFingerprint) || !uuid.test(identity.reasoningId)) return null;
  const intent: ReturnRetryIntent = { ...identity, projectId, acknowledgeUnknown, requestId: crypto.randomUUID() };
  try {
    localStorage.setItem(keyFor(identity), JSON.stringify(intent));
    const persisted = readReturnRetryIntent(identity);
    return persisted?.requestId === intent.requestId ? persisted : null;
  } catch { return null; }
}

export function clearReturnRetryIntent(intent: ReturnRetryIntent): void {
  try {
    if (readReturnRetryIntent(intent)?.requestId === intent.requestId) localStorage.removeItem(keyFor(intent));
  } catch { /* Un fallo de storage no autoriza a crear otro UUID. */ }
}

export function returnRetryIntents(account: string, threadId: string): ReturnRetryIntent[] {
  const result: ReturnRetryIntent[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      let raw: Partial<ReturnRetryIntent> | null;
      try { raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<ReturnRetryIntent> | null; }
      catch { continue; }
      if (raw?.account !== account || raw.threadId !== threadId || typeof raw.sku !== 'string') continue;
      const intent = readReturnRetryIntent({ account, threadId, sku: raw.sku });
      if (intent) result.push(intent);
    }
  } catch { return []; }
  return result;
}

/** Solo una recepción confirmada del mismo cuerpo permite liberar el UUID. */
export async function reconcileReturnRetryIntent(intent: ReturnRetryIntent, signal?: AbortSignal): Promise<boolean> {
  const receipt = await api.get<unknown>(`/uony/threads/${encodeURIComponent(intent.threadId)}`
    + `/requests/${encodeURIComponent(intent.requestId)}/receipt`, { signal });
  if (!receipt || typeof receipt !== 'object') return false;
  const row = receipt as Record<string, unknown>;
  if (row.requestId !== intent.requestId || row.threadId !== intent.threadId || row.status !== 'success'
    || !row.action || typeof row.action !== 'object') return false;
  const action = row.action as Record<string, unknown>;
  if (action.kind !== 'requirements_prepare' || action.action !== 'prepare'
    || action.sku !== intent.sku || action.retry !== true
    || action.acknowledgeUnknown !== intent.acknowledgeUnknown
    || action.expectedRevision !== intent.revision || action.expectedLinkVersion !== intent.linkVersion
    || action.expectedReasoningId !== intent.reasoningId || action.expectedReasoningStatus !== intent.reasoningStatus
    || action.expectedSourceFingerprint !== intent.sourceFingerprint) return false;
  clearReturnRetryIntent(intent);
  return readReturnRetryIntent(intent) === null;
}

export function isReturnRetryRequest(account: string, threadId: string, requestId: string): boolean {
  const active = activeRequests.get(requestId);
  if (active?.account === account && active.threadId === threadId) return true;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      let value: Partial<ReturnRetryIntent> | null;
      try { value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<ReturnRetryIntent> | null; }
      catch { continue; }
      if (value?.account === account && value.threadId === threadId && value.requestId === requestId) return true;
    }
  } catch { return false; }
  return false;
}
