import { useId } from 'react';
import { Icon } from '@/shared/ui';
import { useAuditStore } from '../hooks/useAuditStore';
import { useSchemaActions } from '../hooks/useSchemaActions';

/**
 * «Categorización Automática» (CategorySuggestion, E18). Paso 2: «Confirmar categoría»
 * es la acción sólida; la sugerencia de la IA solo lleva el icono aqua.
 */
export function CategorySuggestion() {
  const { audit } = useAuditStore();
  const { confirmCategory } = useSchemaActions();
  const titleId = useId();
  return (
    <section className="pim-section" aria-labelledby={titleId}>
      <div className="pim-section-head">
        <h3 className="pim-section-title" id={titleId}>
          <Icon name="brain" size={16} />
          <span>Categorización Automática</span>
        </h3>
      </div>
      <div className="pim-auditoria-suggest">
        <span className="pim-auditoria-suggest-icon"><Icon name="sparkles" size={16} /></span>
        <div className="pim-auditoria-suggest-text">
          <p className="pim-auditoria-suggest-main">Este producto parece ser un <strong>"{audit.suggestedCategory}"</strong></p>
          <p className="pim-hint">Basado en el análisis de la URL y contenido extraído</p>
        </div>
        <div className="pim-auditoria-actions">
          <button type="button" className="pim-btn pim-btn-outline" onClick={() => confirmCategory(false)}>
            <Icon name="x" size={16} />Seleccionar otra
          </button>
          <button type="button" className="pim-btn pim-btn-primary" onClick={() => confirmCategory(true)}>
            <Icon name="check-circle-2" size={16} />Confirmar categoría
          </button>
        </div>
      </div>
    </section>
  );
}
