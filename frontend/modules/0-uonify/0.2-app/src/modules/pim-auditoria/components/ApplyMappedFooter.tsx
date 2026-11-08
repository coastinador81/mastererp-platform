import { Icon } from '@/shared/ui';
import { schemaBlocked } from '../model/validation';
import { useAuditStore } from '../hooks/useAuditStore';
import { useSchemaActions } from '../hooks/useSchemaActions';

/**
 * Pie de la lista de campos (paso 4): aviso a la izquierda, «Reiniciar» y la acción
 * sólida «Aplicar datos a Atributos», deshabilitada hasta completar los requeridos.
 */
export function ApplyMappedFooter() {
  const { audit } = useAuditStore();
  const { resetAudit, applyMapped } = useSchemaActions();
  const blocked = schemaBlocked(audit);
  return (
    <>
      {blocked ? (
        <p className="pim-auditoria-warn">
          <Icon name="alert-triangle" size={14} />Completa todos los campos requeridos antes de aplicar
        </p>
      ) : null}
      <div className="pim-auditoria-actions">
        <button type="button" className="pim-btn pim-btn-outline" data-focus="reset-audit" onClick={resetAudit}>
          <Icon name="refresh-cw" size={16} />Reiniciar
        </button>
        <button type="button" className="pim-btn pim-btn-primary" disabled={blocked} onClick={applyMapped}>
          <Icon name="zap" size={16} />Aplicar datos a Atributos ({Object.keys(audit.editableFields).length} campos)
        </button>
      </div>
    </>
  );
}
