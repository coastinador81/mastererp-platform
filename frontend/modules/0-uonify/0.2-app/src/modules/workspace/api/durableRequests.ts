import { api } from '@/shared/api/client';
import { semanticFailureOf, type SemanticFailure } from './liveSemanticFailure';
import { semanticRecoveryOf, type SemanticRecovery } from './semanticRecovery';

export type DurableStatus = 'queued' | 'running' | 'success' | 'error' | 'unknown' | 'cancelled';

export interface LiveReply {
  reply: string;
  model: string;
  effort: string;
  createdAssignmentFocus?: { assignmentId: string; version: number };
  productChanges?: import('@/shared/pim').ProductChange[];
  connectionActions?: unknown;
  conversationForm?: unknown;
  materialAnalysis?: unknown;
  productIntake?: unknown;
  productProposal?: unknown;
}

export interface DurablePending {
  requestId: string;
  threadId: string;
  status: 'queued' | 'running';
  pollUrl?: string;
}

export interface DurableRequest extends Omit<DurablePending, 'status'> {
  status: DurableStatus;
  /** Una consulta de estado conserva su recibo sin sustituir el trabajo consultado. */
  targetRequestId?: string | null;
  /** Un trabajo iniciado por una frase Live conserva esa burbuja en vez de recrear el prompt. */
  sourceLiveTurnId?: string | null;
  progress?: { stage: string; seq: number; provisional?: { text: string; seq: number; tentative: true } };
  response?: LiveReply;
  error?: { code: string; message: string };
  semanticFailure?: SemanticFailure;
  semanticRecovery?: SemanticRecovery;
  connectionActions?: unknown;
}

export interface DurableRequestSummary extends DurableRequest {
  text: string;
  model: string;
  effort: string;
  createdAt: string;
}

export interface UnresolvedDurableRequest extends DurableRequest {
  text: string;
  createdAt: string;
}

const statuses: DurableStatus[] = ['queued', 'running', 'success', 'error', 'unknown', 'cancelled'];
const LIVE_TURN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isDurablePending = (value: unknown): value is DurablePending => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<DurablePending>;
  return typeof row.requestId === 'string' && typeof row.threadId === 'string'
    && (row.status === 'queued' || row.status === 'running');
};

export function isDurableRequest(value: unknown): value is DurableRequest {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<DurableRequest>;
  const failure = row.semanticFailure === undefined ? undefined : semanticFailureOf(row.semanticFailure);
  return typeof row.requestId === 'string' && typeof row.threadId === 'string'
    && statuses.includes(row.status as DurableStatus)
    && (row.semanticRecovery === undefined || !!semanticRecoveryOf(row.semanticRecovery, row.requestId))
    && (failure === undefined || !!failure && failure.persistence === 'saved'
      && (row.status === 'error' || row.status === 'unknown' && failure.execution === 'unknown')
      && failure.requestId === row.requestId && failure.threadId === row.threadId
      && (!row.sourceLiveTurnId || failure.turnId === row.sourceLiveTurnId))
    && (row.targetRequestId === undefined || row.targetRequestId === null
      || typeof row.targetRequestId === 'string' && LIVE_TURN_ID.test(row.targetRequestId)
        && row.targetRequestId !== row.requestId)
    && (row.sourceLiveTurnId === undefined || row.sourceLiveTurnId === null
      || typeof row.sourceLiveTurnId === 'string' && LIVE_TURN_ID.test(row.sourceLiveTurnId));
}

export async function getDurableRequest(requestId: string, signal?: AbortSignal): Promise<DurableRequest> {
  const result = await api.get<unknown>(`/uony/requests/${encodeURIComponent(requestId)}`, { signal });
  if (!isDurableRequest(result) || result.requestId !== requestId) throw new Error('No hemos podido consultar el estado de tu petición.');
  return result;
}

export async function getRecentDurableRequests(signal?: AbortSignal): Promise<DurableRequestSummary[]> {
  const result = await api.get<{ requests?: unknown }>('/uony/requests/recent', { signal });
  if (!result || !Array.isArray(result.requests)) throw new Error('No hemos podido recuperar tus peticiones en curso.');
  const valid = (item: unknown): item is DurableRequestSummary => {
    if (!isDurableRequest(item)) return false;
    const row = item as Partial<DurableRequestSummary>;
    return typeof row.text === 'string' && typeof row.model === 'string'
      && typeof row.effort === 'string' && typeof row.createdAt === 'string';
  };
  if (!result.requests.every(valid)) throw new Error('El estado de tus peticiones no ha respondido correctamente.');
  return result.requests;
}

/** Recorre todas las páginas: un error de consumo antiguo sigue siendo relevante. */
export async function getUnresolvedDurableRequests(signal?: AbortSignal): Promise<UnresolvedDurableRequest[]> {
  const requests: UnresolvedDurableRequest[] = [];
  const cursors = new Set<string>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const suffix: string = cursor ? `?after=${encodeURIComponent(cursor)}` : '';
    const result: { requests?: unknown; nextCursor?: unknown } = await api.get(`/uony/requests/unresolved${suffix}`, { signal });
    if (!result || !Array.isArray(result.requests) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) {
      throw new Error('No hemos podido consultar tus peticiones inciertas.');
    }
    for (const item of result.requests) {
      if (!isDurableRequest(item) || item.status !== 'unknown') throw new Error('El estado de una petición incierta no es válido.');
      const row = item as UnresolvedDurableRequest;
      if (typeof row.text !== 'string' || typeof row.createdAt !== 'string') throw new Error('El estado de una petición incierta está incompleto.');
      if (!seen.has(row.requestId)) { requests.push(row); seen.add(row.requestId); }
    }
    cursor = result.nextCursor;
    if (cursor) {
      if (cursors.has(cursor)) throw new Error('La lista de peticiones inciertas no ha avanzado.');
      cursors.add(cursor);
    }
  } while (cursor && !signal?.aborted);
  return requests;
}
