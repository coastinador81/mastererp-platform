const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DISPOSITIONS = ['reclassified', 'reused', 'observing', 'reconciliation_required', 'blocked'] as const;
const BUSINESS_STATUSES = ['queued', 'running', 'success', 'error', 'unknown'] as const;
const KEYS = 'businessExecutionId,businessRequestId,businessStatus,disposition,logicalRequestId,recoveryCommandId,semanticAttemptId';
const OBSERVED_KEYS = KEYS.replace('logicalRequestId,', 'logicalRequestId,observedRequestId,');

/** B conserva su recibo; observar o recuperar A no equivale a ejecutarlo de nuevo. */
export interface SemanticRecovery {
  logicalRequestId: string;
  recoveryCommandId: string;
  semanticAttemptId: string | null;
  businessExecutionId: string | null;
  businessRequestId: string | null;
  /** El recibo real del intento en curso. Ausente en respuestas anteriores. */
  observedRequestId?: string | null;
  disposition: typeof DISPOSITIONS[number];
  businessStatus: typeof BUSINESS_STATUSES[number] | null;
}

export function semanticRecoveryOf(value: unknown, commandId: unknown): SemanticRecovery | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (![KEYS, OBSERVED_KEYS].includes(Object.keys(row).sort().join(','))
    || ![row.logicalRequestId, row.recoveryCommandId].every(id => typeof id === 'string' && UUID.test(id))
    || row.recoveryCommandId !== commandId
    || ![row.semanticAttemptId, row.businessExecutionId, row.businessRequestId]
      .every(id => id === null || typeof id === 'string' && UUID.test(id))
    || (row.businessExecutionId === null) !== (row.businessRequestId === null)
    || row.businessRequestId === null && row.businessStatus !== null
    || 'observedRequestId' in row && !(row.observedRequestId === null
      || row.disposition === 'observing' && typeof row.observedRequestId === 'string' && UUID.test(row.observedRequestId))
    || !DISPOSITIONS.includes(row.disposition as SemanticRecovery['disposition'])
    || !(row.businessStatus === null || BUSINESS_STATUSES.includes(row.businessStatus as typeof BUSINESS_STATUSES[number]))
    || row.disposition === 'reclassified' && row.businessRequestId !== commandId
    || row.disposition === 'reused' && row.businessRequestId === null) return null;
  return row as unknown as SemanticRecovery;
}
