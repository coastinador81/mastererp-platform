import { api, ApiError } from '@/shared/api/client';

export interface AssignmentWork {
  id: string;
  kind: 'materials';
  status: string;
  revision: number;
  currentRevision: boolean;
  scope: 'started_for_assignment';
}

export interface RelatedProductWork {
  id: string;
  kind: 'materials' | 'reasoning';
  status: string;
  scope: 'linked_product_current_revision';
}

export interface AssignmentReturnItem {
  assignment: { id: string; label: string; status: string; nextStep: string; version: number };
  product: { id: string; name: string; revision: number } | null;
  assignmentWork: AssignmentWork | null;
  relatedProductWork: RelatedProductWork | null;
}

export interface AssignmentReturn {
  resolution: 'none' | 'single' | 'ambiguous' | 'focused';
  focusVersion: number;
  assignments: AssignmentReturnItem[];
  moreAvailable: boolean;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function validWork(value: unknown, causal: boolean): boolean {
  if (value === null) return true;
  if (!record(value) || typeof value.id !== 'string' || typeof value.status !== 'string') return false;
  if (causal) return value.kind === 'materials' && value.scope === 'started_for_assignment'
    && typeof value.currentRevision === 'boolean' && Number.isSafeInteger(value.revision);
  return (value.kind === 'materials' || value.kind === 'reasoning')
    && value.scope === 'linked_product_current_revision';
}

function validItem(value: unknown): value is AssignmentReturnItem {
  if (!record(value) || !record(value.assignment)) return false;
  const assignment = value.assignment;
  const product = value.product;
  return typeof assignment.id === 'string' && !!assignment.id
    && typeof assignment.label === 'string' && !!assignment.label && assignment.label.length <= 80
    && typeof assignment.status === 'string' && typeof assignment.nextStep === 'string'
    && Number.isSafeInteger(assignment.version) && (assignment.version as number) > 0
    && (product === null || record(product) && typeof product.id === 'string'
      && typeof product.name === 'string' && Number.isSafeInteger(product.revision))
    && validWork(value.assignmentWork, true) && validWork(value.relatedProductWork, false);
}

/** Solo 404 de ruta ausente permite la tarjeta antigua; un hilo borrado no es compatibilidad. */
export async function getAssignmentReturn(threadId: string, signal?: AbortSignal):
  Promise<AssignmentReturn | null> {
  let result: unknown;
  try {
    result = await api.get(`/uony/threads/${encodeURIComponent(threadId)}/assignment-return`, { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404
      && record(error.data) && error.data.detail === 'Not Found') return null;
    throw error;
  }
  if (!record(result) || !['none', 'single', 'ambiguous', 'focused'].includes(String(result.resolution))
    || !Number.isSafeInteger(result.focusVersion) || !Array.isArray(result.assignments)
    || result.assignments.length > 2 || !result.assignments.every(validItem)
    || new Set(result.assignments.map((item: AssignmentReturnItem) => item.assignment.id)).size
      !== result.assignments.length || typeof result.moreAvailable !== 'boolean') {
    throw new Error('No hemos podido recuperar tus encargos guardados.');
  }
  return result as unknown as AssignmentReturn;
}
