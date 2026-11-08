const CATEGORIES = ['provider', 'timeout', 'invalid_response', 'preparation', 'dependency', 'persistence', 'internal'] as const;
const PHASES = ['dependency', 'preparation', 'authentication', 'connection_revalidation', 'classification', 'client_setup', 'client_close',
  'request_setup', 'provider_wait', 'response_validation', 'decision_validation', 'persist_success', 'persist_failure',
  'admission', 'delivery'] as const;
const CODES = ['semantic_timeout', 'semantic_dependency_timeout', 'semantic_invalid_response', 'semantic_preparation_failed',
  'semantic_persistence_failed', 'semantic_internal_error', 'google_unavailable', 'reauthorize', 'permission_denied',
  'model_unavailable', 'quota_exceeded'] as const;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,80}$/;
const KEYS = 'category,code,delivery,execution,interpretation,message,persistence,phase,requestId,threadId,turnId';

interface SemanticFailureDetails {
  threadId: string;
  turnId: string;
  requestId: string;
  message: string;
  delivery: 'text_only';
  providerCode?: number;
}
export type SemanticFailure = SemanticFailureDetails & ({
  category: typeof CATEGORIES[number]; phase: typeof PHASES[number]; code: typeof CODES[number];
  interpretation: 'failed'; execution: 'not_started'; persistence: 'pending' | 'saved' | 'unknown';
} | {
  category: 'admission'; phase: 'admission'; code: 'semantic_admission_unknown';
  interpretation: 'succeeded'; execution: 'unknown'; persistence: 'saved' | 'unknown';
} | {
  category: 'admission'; phase: 'admission'; code: 'semantic_admission_failed';
  interpretation: 'succeeded'; execution: 'not_started'; persistence: 'pending' | 'saved' | 'unknown';
});
export type SemanticFailureEvent = SemanticFailure & { type: 'semantic_failure' };

/** El error técnico no autoriza ejecutar ni repetir la solicitud. */
export function semanticFailureOf(value: unknown): SemanticFailure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort().join(',');
  if (keys !== KEYS && keys !== KEYS.replace(',requestId', ',providerCode,requestId')) return null;
  if (![row.threadId, row.turnId, row.requestId].every(id => typeof id === 'string' && IDENTIFIER.test(id))
    || typeof row.message !== 'string' || !row.message.trim() || row.message.length > 500 || row.message.includes('\0')
    || row.delivery !== 'text_only'
    || !['pending', 'saved', 'unknown'].includes(String(row.persistence))
    || ('providerCode' in row && (typeof row.providerCode !== 'number' || !Number.isInteger(row.providerCode)
      || row.providerCode < 400 || row.providerCode > 599))) return null;
  if (row.category === 'admission') {
    if (row.phase !== 'admission' || row.interpretation !== 'succeeded'
      || !(row.code === 'semantic_admission_unknown' && row.execution === 'unknown' && row.persistence !== 'pending'
        || row.code === 'semantic_admission_failed' && row.execution === 'not_started')) return null;
  } else if (!CATEGORIES.includes(row.category as typeof CATEGORIES[number])
    || !PHASES.includes(row.phase as typeof PHASES[number]) || !CODES.includes(row.code as typeof CODES[number])
    || row.interpretation !== 'failed' || row.execution !== 'not_started') return null;
  return row as unknown as SemanticFailure;
}

export function semanticFailureEventOf(value: Record<string, unknown>): SemanticFailureEvent | null {
  const { type, ...details } = value;
  if (type !== 'semantic_failure') return null;
  const failure = semanticFailureOf(details);
  return failure ? { type, ...failure } : null;
}
