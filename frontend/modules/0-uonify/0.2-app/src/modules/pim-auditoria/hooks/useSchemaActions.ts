import { useCallback } from 'react';
import { toast } from '@/shared/ui';
import type { FieldMap } from '../model/types';
import { RESET_AUDIT_PATCH, schemaFor } from '../model/schemas';
import { editFieldPatch, validateFields, withValidation } from '../model/validation';
import { neighbourOf, planApplyMapped } from '../model/fields';
import { useAuditStore } from './useAuditStore';
import { useAuditFocus } from './useAuditFocus';

/**
 * Pasos 2-4 de la auditoría (ProductsPIMInterface.tsx: handleCategoryConfirmation/
 * Selection, loadUonifySchema, updateEditableField, removeField, handleApplyMappedData,
 * resetAuditData) sobre la porción `audit` del producto.
 */
export function useSchemaActions() {
  const { ctx, scope, read, patch, setCustomFields } = useAuditStore();
  const requestFocus = useAuditFocus();

  const loadSchema = useCallback((category: string) => {
    const schema = schemaFor(category); // E18/E19: sin esquema propio → 'General'
    patch({ uonifySchema: schema, ...validateFields(schema, read().editableFields), showSchemaComparison: true });
  }, [patch, read]);

  const confirmCategory = useCallback((confirmed: boolean) => {
    const { suggestedCategory } = read();
    patch({ isCategoryConfirmed: confirmed });
    if (confirmed && suggestedCategory) {
      patch({ selectedCategory: suggestedCategory });
      loadSchema(suggestedCategory);
    }
    if (!confirmed) requestFocus('category');
    else {
      const first = read().missingFields[0];
      requestFocus(first !== undefined ? `drag:${first}` : 'toggle-add-field', { onlyIfLost: true });
    }
  }, [read, patch, loadSchema, requestFocus]);

  const selectCategory = useCallback((category: string) => {
    patch({ selectedCategory: category });
    loadSchema(category);
  }, [patch, loadSchema]);

  const updateField = useCallback((field: string, value: unknown) => {
    patch(editFieldPatch(read(), field, value));
  }, [patch, read]);

  const removeField = useCallback((fieldName: string) => {
    const audit = read();
    const neighbour = neighbourOf(Object.keys(audit.editableFields), fieldName);
    const editableFields = { ...audit.editableFields };
    delete editableFields[fieldName];
    patch(withValidation(audit, editableFields));
    toast.success(`Campo "${fieldName}" eliminado`);
    requestFocus(neighbour !== null ? `remove:${neighbour}` : 'reset-audit');
  }, [read, patch, requestFocus]);

  const resetAudit = useCallback(() => {
    patch(RESET_AUDIT_PATCH);
    requestFocus('audit-url');
  }, [patch, requestFocus]);

  /** handleApplyMappedData: galería, producto abierto (E28) y campos personalizados. */
  const applyMapped = useCallback(() => {
    const audit = read();
    const fieldsToApply = (audit.showSchemaComparison ? audit.editableFields : audit.mappedFields) || {};
    const plan = planApplyMapped(fieldsToApply, audit.uonifySchema);
    if (plan.images.length > 0) {
      const saved = Array.isArray(ctx.product?.images) ? (ctx.product.images as unknown[]) : [];
      scope.update<unknown[]>('images', prev => [...(Array.isArray(prev) ? prev : []), ...plan.images], saved);
      toast.success(`${plan.images.length} imágenes agregadas a la galería`);
    }
    if (Object.keys(plan.productPatch).length > 0) ctx.edit(plan.productPatch);
    setCustomFields(plan.customFields); // sustituye los campos existentes, como el original
    patch(RESET_AUDIT_PATCH);
    toast.success(`¡${plan.appliedCount} campos aplicados exitosamente! Revisa la pestaña Atributos.`);
    requestFocus('audit-url');
  }, [read, ctx, scope, setCustomFields, patch, requestFocus]);

  /** Mezcla datos encontrados (documentos o API) en los campos editables y revalida. */
  const mergeFields = useCallback((data: FieldMap): boolean => {
    if (Object.keys(data).length === 0) return false;
    const audit = read();
    patch(withValidation(audit, { ...audit.editableFields, ...data }));
    return true;
  }, [read, patch]);

  return { confirmCategory, selectCategory, updateField, removeField, resetAudit, applyMapped, mergeFields };
}
