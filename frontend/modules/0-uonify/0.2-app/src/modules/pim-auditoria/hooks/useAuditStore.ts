import { useCallback, useMemo } from 'react';
import { usePimScope, usePimSlice, useTabContext, type PimTabContext, type PimScope } from '@/shared/pim';
import type { AuditState, CustomField } from '../model/types';
import { withDefaults } from '../model/schemas';
import { patchAudit, readAudit } from '../api/auditJobs';

export interface AuditStore {
  ctx: PimTabContext;
  scope: PimScope;
  /** Porción `audit` con sus valores por defecto (se actualiza al cambiar). */
  audit: AuditState;
  /** Lectura al momento (para manejadores que corren después de un await). */
  read: () => AuditState;
  patch: (patch: Partial<AuditState>) => void;
  /** Campos personalizados actuales (porción `customFields`, o los del producto guardado). */
  customFields: () => CustomField[];
  setCustomFields: (next: CustomField[] | ((current: CustomField[]) => CustomField[])) => void;
  /** Id del producto abierto para el scraper (no se envía en «Nuevo Producto»). */
  productId: string | undefined;
}

/** Estado de la auditoría del producto de la pestaña y sus escrituras. */
export function useAuditStore(): AuditStore {
  const ctx = useTabContext();
  const scope = usePimScope();
  const [stored] = usePimSlice<AuditState | undefined>('audit', undefined);
  const audit = useMemo(() => withDefaults(stored), [stored]);
  const read = useCallback(() => readAudit(scope), [scope]);
  const patch = useCallback((next: Partial<AuditState>) => patchAudit(scope, next), [scope]);
  const product = ctx.product;
  const customFields = useCallback((): CustomField[] => {
    const list = scope.get<unknown>('customFields', null);
    if (Array.isArray(list)) return list as CustomField[];
    return Array.isArray(product?.customFields) ? (product.customFields as CustomField[]) : [];
  }, [scope, product]);
  const setCustomFields = useCallback<AuditStore['setCustomFields']>(next => {
    scope.set('customFields', typeof next === 'function' ? next(customFields()) : next);
  }, [scope, customFields]);
  // El original enviaba el id del producto (su SKU si no tiene id).
  const productId = ctx.isNew ? undefined : String(product?.id ?? ctx.key);
  return { ctx, scope, audit, read, patch, customFields, setCustomFields, productId };
}
