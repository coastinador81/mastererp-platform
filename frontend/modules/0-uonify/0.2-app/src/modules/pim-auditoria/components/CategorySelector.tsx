import { useId } from 'react';
import { Icon } from '@/shared/ui';
import { UONIFY_CATEGORIES } from '../model/schemas';
import { useAuditStore } from '../hooks/useAuditStore';
import { useSchemaActions } from '../hooks/useSchemaActions';

/** «Seleccionar Categoría Correcta» (CategorySelector, E19): elegir carga su esquema. */
export function CategorySelector() {
  const { audit } = useAuditStore();
  const { selectCategory } = useSchemaActions();
  const titleId = useId();
  const selectId = useId();
  const selected = audit.selectedCategory || '';
  return (
    <section className="pim-section" aria-labelledby={titleId}>
      <div className="pim-section-head">
        <h3 className="pim-section-title" id={titleId}>
          <Icon name="tag" size={16} />
          <span>Seleccionar Categoría Correcta</span>
        </h3>
      </div>
      <div className="pim-auditoria-grid">
        <div className="pim-field">
          <label className="pim-label" htmlFor={selectId}>Categoría del Producto</label>
          <select
            id={selectId}
            className="pim-select"
            data-focus="category"
            value={selected}
            onChange={event => selectCategory(event.target.value)}
          >
            <option value="" disabled hidden>Seleccionar categoría...</option>
            {UONIFY_CATEGORIES.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
