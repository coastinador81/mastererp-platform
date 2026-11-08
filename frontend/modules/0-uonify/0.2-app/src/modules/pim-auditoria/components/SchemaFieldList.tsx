import { useId } from 'react';
import { Icon } from '@/shared/ui';
import type { FieldValidation } from '../model/types';
import { STATUS_TEXT } from '../model/schemas';
import { own } from '../model/translations';
import { fieldStatus } from '../model/validation';
import { useAuditStore } from '../hooks/useAuditStore';
import { useSchemaActions } from '../hooks/useSchemaActions';
import { SchemaFieldControl } from './SchemaFieldControl';

/** Icono de estado de un campo (getValidationIcon del original). */
function ValidationIcon({ status }: { status: FieldValidation }) {
  if (status === 'valid') return <span className="pim-auditoria-vicon pim-auditoria--valid"><Icon name="check-circle-2" size={16} /></span>;
  if (status === 'missing') return <span className="pim-auditoria-vicon pim-auditoria--missing"><Icon name="x-circle" size={16} /></span>;
  return <span className="pim-auditoria-vicon pim-auditoria--review"><Icon name="clock" size={16} /></span>;
}

/**
 * Lista de campos editables (SchemaComparisonSection): estado, REQ, papelera y el
 * control de cada campo. Escribir solo repinta lo que depende del valor (E27).
 */
export function SchemaFieldList() {
  const { audit } = useAuditStore();
  const { updateField, removeField } = useSchemaActions();
  const uid = useId();
  const entries = Object.entries(audit.editableFields);
  if (entries.length === 0 || !audit.uonifySchema) return null;
  const schema = audit.uonifySchema;
  return (
    <div className="pim-auditoria-list" data-scroll="fields">
      <div className="pim-auditoria-grid">
        {entries.map(([field, value], index) => {
          const { validation, isRequired, tone } = fieldStatus(audit, field, value);
          const fieldSchema = own(schema.fields, field);
          const inputId = `${uid}-f${index}`;
          const isSwitch = fieldSchema?.type === 'boolean';
          return (
            <div key={field} className={`pim-auditoria-field ${tone}`}>
              <div className="pim-auditoria-field-head">
                <div className="pim-auditoria-field-name">
                  <ValidationIcon status={validation} />
                  {isSwitch ? (
                    <span className="pim-auditoria-field-label" id={`${inputId}-name`}>{field}</span>
                  ) : (
                    <label className="pim-auditoria-field-label" id={`${inputId}-name`} htmlFor={inputId}>{field}</label>
                  )}
                  {isRequired ? <span className="pim-badge pim-badge-outline">REQ</span> : null}
                </div>
                <div className="pim-auditoria-field-status">
                  <span data-region="field-status">{STATUS_TEXT[validation] || ''}</span>
                  <button
                    type="button"
                    className="pim-btn pim-btn-ghost pim-btn-icon pim-btn-sm pim-auditoria-trash"
                    data-focus={`remove:${field}`}
                    aria-label={`Eliminar ${field}`}
                    data-tooltip={`Eliminar ${field}`}
                    data-tooltip-pos="below"
                    data-tooltip-align="end"
                    onClick={() => removeField(field)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              <SchemaFieldControl field={field} value={value} schema={fieldSchema} inputId={inputId} onChange={updateField} />
              {fieldSchema?.unit ? <p className="pim-hint">Unidad: {fieldSchema.unit}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
