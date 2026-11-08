import { api, ApiError } from '@/shared/api/client';
import { productIntakesApi } from './productIntakes';

export interface ChatMaterialScope {
  threadId: string;
  intakeId?: string;
  isCurrent: () => boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalidFocus = () => new ApiError(409, { error: 'assignment_context_conflict',
  message: 'El encargo enfocado no coincide con esta carpeta o ficha. Revisa el encargo antes de analizar.' });

/** Lee el foco vigente: un nombre, un mensaje antiguo o la ficha por sí solos no atribuyen trabajo. */
export async function focusedAssignmentForMaterials(scope: ChatMaterialScope, sku: string,
  revision: number, folderId: string, signal?: AbortSignal): Promise<string | null> {
  const response: unknown = await api.get(`/uony/threads/${encodeURIComponent(scope.threadId)}/assignment-focus`, { signal });
  if (!record(response) || !record(response.focus) || !Number.isSafeInteger(response.focus.version))
    throw invalidFocus();
  const focus = response.focus.current;
  if (focus === null) return null;
  if (!record(focus) || typeof focus.id !== 'string' || !uuid.test(focus.id)
    || !('productId' in focus) || !('intakeId' in focus)
    || (focus.productId !== null && (typeof focus.productId !== 'string' || !uuid.test(focus.productId)))
    || (focus.intakeId !== null && (typeof focus.intakeId !== 'string' || !uuid.test(focus.intakeId))))
    throw invalidFocus();
  // La tarjeta de intake solo atribuye al encargo que conserva ese mismo intake.
  if (focus.intakeId !== (scope.intakeId ?? null)) throw invalidFocus();
  if (focus.productId === null && focus.intakeId === null) throw invalidFocus();
  const preparation: unknown = await api.get(`/products/${encodeURIComponent(sku)}/preparation`, { signal });
  if (!record(preparation) || !record(preparation.product))
    throw invalidFocus();
  const product = preparation.product;
  if (typeof product.id !== 'string' || !uuid.test(product.id)
    || product.sku !== sku || product.revision !== revision) throw invalidFocus();
  if (focus.productId !== null && focus.productId !== product.id) throw invalidFocus();
  if (scope.intakeId) {
    const intake = await productIntakesApi.get(scope.intakeId, scope.threadId, signal);
    if (intake.id !== scope.intakeId || intake.threadId !== scope.threadId || intake.status !== 'linked'
      || intake.folder?.id !== folderId || intake.product?.sku !== sku) throw invalidFocus();
  }
  return focus.id;
}
