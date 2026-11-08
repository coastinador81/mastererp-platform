export type CreativePreparationState = 'stale' | 'needs_input' | 'needs_preparation' | 'prepared';

export interface CreativePreparation {
  planId: string;
  revision: number;
  planSha256: string;
  threadId: string;
  uonifyProjectId: string | null;
  googleCloudProjectId: string;
  state: CreativePreparationState;
  sourceCurrent: boolean;
  model: { model: string; label: string; medium: string; selectionStatus: string };
  compatibleModels: { id: string; label: string }[];
  // Plan por unidad persistido en backend (Bloque 1·paso 2): 'prepared' trae snapshotSha256 (units_sha256, 64 hex);
  // 'not_prepared' lo deja en null. requestGroupSha256 y executionAuthorized siguen FIJOS (no se abre gasto).
  draft: ({ status: 'not_prepared'; snapshotSha256: null } | { status: 'prepared'; snapshotSha256: string })
    & { requestGroupSha256: null; requestHashes: string[]; unitIds: string[]; executionAuthorized: false };
  missingInputs: string[];
  technicalBlockers: string[];
  quoteReadiness: { knownGenerationComponentUsd: null; completeMaximumUsd: null;
    currency: 'USD'; approvalReady: false; missingForMaximum: string[] };
  limits: { spendLimitUsd: string; providerCallsStarted: 0; executionAuthorized: false };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 500): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= max;
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const stringList = (value: unknown, max = 80): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every(item => text(item));
// El draft solo tiene dos formas válidas, acopladas: 'not_prepared'⇒snapshotSha256 null; 'prepared'⇒hash de 64 hex.
const draftReady = (draft: Record<string, unknown>): boolean =>
  (draft.status === 'not_prepared' && draft.snapshotSha256 === null)
  || (draft.status === 'prepared' && hash(draft.snapshotSha256));

export function creativePreparationOf(value: unknown, threadId: string): CreativePreparation | null | undefined {
  if (!record(value) || !Object.prototype.hasOwnProperty.call(value, 'creativePreparation')) return undefined;
  const item = value.creativePreparation;
  if (item === null) return null;
  if (!record(item) || !uuid(item.planId) || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1
    || !hash(item.planSha256) || item.threadId !== threadId || !text(item.googleCloudProjectId, 64)
    || !['stale', 'needs_input', 'needs_preparation', 'prepared'].includes(String(item.state))
    || typeof item.sourceCurrent !== 'boolean' || !(item.uonifyProjectId === null || uuid(item.uonifyProjectId))
    || ((item.state === 'stale') === item.sourceCurrent)
    || !record(item.model) || !text(item.model.model, 100) || !text(item.model.label, 100)
    || !text(item.model.medium, 20) || !text(item.model.selectionStatus, 40)
    || !Array.isArray(item.compatibleModels) || item.compatibleModels.length > 8
    || !item.compatibleModels.every(option => record(option) && text(option.id, 100) && text(option.label, 100))
    || !record(item.draft) || !draftReady(item.draft)
    || item.draft.requestGroupSha256 !== null
    || item.draft.executionAuthorized !== false || !Array.isArray(item.draft.requestHashes)
    || !item.draft.requestHashes.every(hash)
    || !stringList(item.draft.unitIds) || !stringList(item.missingInputs)
    || !stringList(item.technicalBlockers)
    || !record(item.quoteReadiness) || item.quoteReadiness.knownGenerationComponentUsd !== null
    || item.quoteReadiness.completeMaximumUsd !== null || item.quoteReadiness.currency !== 'USD'
    || item.quoteReadiness.approvalReady !== false || !stringList(item.quoteReadiness.missingForMaximum)
    || !record(item.limits) || !/^\d+\.\d{2}$/.test(String(item.limits.spendLimitUsd))
    || item.limits.providerCallsStarted !== 0 || item.limits.executionAuthorized !== false) return undefined;
  return item as unknown as CreativePreparation;
}
