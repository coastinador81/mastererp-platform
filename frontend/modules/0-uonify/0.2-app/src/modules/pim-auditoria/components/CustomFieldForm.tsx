import { useId } from 'react';
import { Icon } from '@/shared/ui';
import { NEW_FIELD_TYPES } from '../model/schemas';
import type { FieldManager } from '../hooks/useFieldManager';

/** «Agregar Campo Personalizado» (DragDropFieldManager) con las instrucciones del original. */
export function CustomFieldForm({ manager }: { manager: FieldManager }) {
  const uid = useId();
  const { form, createField, toggleAddField, cancelAddField } = manager;
  return (
    <section className="pim-section" aria-labelledby={`${uid}-title`}>
      <div className="pim-section-head">
        <h3 className="pim-section-title" id={`${uid}-title`}>
          <Icon name="plus" size={16} />
          <span>Agregar Campo Personalizado</span>
        </h3>
        <div className="pim-section-actions">
          <button
            type="button"
            className="pim-btn pim-btn-outline pim-btn-sm"
            data-focus="toggle-add-field"
            aria-expanded={form.isAddingField}
            onClick={toggleAddField}
          >
            {form.isAddingField ? 'Cancelar' : 'Nuevo Campo'}
          </button>
        </div>
      </div>
      {form.isAddingField ? (
        <div className="pim-auditoria-add-form">
          <div className="pim-auditoria-grid">
            <div className="pim-field">
              <label className="pim-label" htmlFor={`${uid}-name`}>Nombre del Campo</label>
              <input
                id={`${uid}-name`}
                className="pim-input"
                type="text"
                data-focus="new-field-name"
                value={form.newFieldName}
                placeholder="Ej: Garantía extendida"
                onChange={event => form.setNewFieldName(event.target.value)}
              />
            </div>
            <div className="pim-field">
              <label className="pim-label" htmlFor={`${uid}-type`}>Tipo de Campo</label>
              <select
                id={`${uid}-type`}
                className="pim-select"
                data-focus="new-field-type"
                value={form.newFieldType}
                onChange={event => form.setNewFieldType(event.target.value)}
              >
                {NEW_FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            {form.newFieldType !== 'checkbox' ? (
              <div className="pim-field pim-auditoria-wide">
                <label className="pim-label" htmlFor={`${uid}-value`}>Valor Inicial</label>
                <input
                  id={`${uid}-value`}
                  className="pim-input"
                  type="text"
                  data-focus="new-field-value"
                  value={form.newFieldValue}
                  placeholder="Valor por defecto..."
                  onChange={event => form.setNewFieldValue(event.target.value)}
                />
              </div>
            ) : null}
          </div>
          <div className="pim-auditoria-actions">
            <button type="button" className="pim-btn pim-btn-ghost" onClick={cancelAddField}>Cancelar</button>
            <button type="button" className="pim-btn pim-btn-soft" onClick={createField}>
              <Icon name="plus" size={16} />Crear Campo
            </button>
          </div>
        </div>
      ) : null}
      <div className="pim-auditoria-tips">
        <h4 className="pim-auditoria-tips-title">💡 Instrucciones:</h4>
        <ul>
          <li>• <strong>Arrastra</strong> campos desde "Datos Faltantes" hacia la "Zona de Gestión"</li>
          <li>• Los campos arrastrados se agregarán automáticamente a la gestión</li>
          <li>• Puedes crear <strong>campos personalizados</strong> usando el formulario</li>
          <li>• Los campos <strong>requeridos</strong> son prioritarios</li>
        </ul>
      </div>
    </section>
  );
}
