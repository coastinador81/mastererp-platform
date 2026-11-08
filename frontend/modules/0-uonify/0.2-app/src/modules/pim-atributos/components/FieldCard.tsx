import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import {
  FIELD_TYPES,
  T,
  fieldTypeIconClass,
  fieldTypeIconName,
  isTechnicalValue,
  showsFieldAI,
  shownValue,
  typeLabel,
} from '../model/fields';
import type { CustomField } from '../model/types';
import type { CustomFieldsApi } from '../hooks/useCustomFields';
import { FieldValueControl } from './FieldValueControl';
import { radixSelectKeys } from './selectKeys';

interface FieldCardProps {
  field: CustomField;
  /** Prefijo de ids del campo (`<uid>-f<índice>`). */
  baseId: string;
  isNew: boolean;
  entering: boolean;
  api: CustomFieldsApi;
  onFieldAI: (id: string) => void;
}

/**
 * Un campo personalizado: fila compacta si está confirmado (icono de tipo ·
 * nombre · valor · «Editar» y eliminar) o tarjeta de edición (nombre · tipo ·
 * valor, opciones, eliminar y confirmar). CustomFieldEditor.tsx del original.
 */
export function FieldCard({ field, baseId, isNew, entering, api, onFieldAI }: FieldCardProps) {
  const name = String(field.name ?? '');
  const removeButton = (
    <button
      type="button"
      className="pim-btn pim-btn-ghost pim-btn-icon pim-atributos-remove"
      data-action="remove-field"
      data-field-id={field.id}
      aria-label={`Eliminar campo${name ? ` ${name}` : ''}`}
      data-tooltip="Eliminar campo"
      data-tooltip-align="end"
      onClick={() => api.remove(field.id)}
    >
      <Icon name="trash" size={16} />
    </button>
  );

  if (field.isConfirmed) {
    const mono = field.type !== 'checkbox' && Boolean(field.value) && isTechnicalValue(name, field.value);
    return (
      <article className={clsx('pim-atributos-card pim-atributos-row is-confirmed', entering && 'is-entering')} data-field-card={field.id}>
        <span className="pim-atributos-type-box" aria-hidden="true">
          <Icon name={fieldTypeIconName(field.type)} size={16} className={fieldTypeIconClass(field.type)} />
        </span>
        <div className="pim-atributos-summary-text">
          <h4 className="pim-atributos-field-name">{name}</h4>
          <p className="pim-atributos-field-value">
            {isNew ? <><span className="pim-atributos-field-type">{typeLabel(field.type)}</span>: </> : null}
            <span className={clsx('pim-atributos-field-shown', mono && 'pim-mono')}>{shownValue(field, isNew)}</span>
          </p>
        </div>
        <div className="pim-atributos-summary-actions">
          {isNew ? <span className="pim-badge pim-badge-green"><Icon name="check" size={12} />{T.fieldAdded}</span> : null}
          <div className="pim-toolbar">
            <button
              type="button"
              className="pim-btn pim-btn-ghost pim-btn-sm pim-atributos-edit"
              data-action="edit-field"
              data-field-id={field.id}
              aria-label={`${T.editField} campo ${name}`}
              onClick={() => api.edit(field.id)}
            >
              <Icon name="edit" size={14} />
              <span>{T.editField}</span>
            </button>
            {removeButton}
          </div>
        </div>
      </article>
    );
  }

  const isCheckbox = field.type === 'checkbox';
  const valueId = `${baseId}-value`;
  return (
    <article className={clsx('pim-atributos-card is-editing', entering && 'is-entering')} data-field-card={field.id}>
      <div className={clsx('pim-atributos-form', isNew && 'is-create')}>
        <div className="pim-field pim-atributos-f-name">
          <div className="pim-atributos-label-row">
            <label className="pim-label" htmlFor={`${baseId}-name`}>{T.fieldName}</label>
            {isNew ? (
              <button
                type="button"
                className="pim-btn pim-btn-ai pim-btn-sm pim-atributos-ai"
                data-action="field-ai"
                data-field-id={field.id}
                aria-label="Uony: generar título"
                hidden={!showsFieldAI(name)}
                onClick={() => onFieldAI(field.id)}
              >
                <Icon name="uony" size={12} />
                <span>Uony</span>
              </button>
            ) : null}
          </div>
          <input
            id={`${baseId}-name`}
            className="pim-input"
            type="text"
            data-field-name=""
            data-field-id={field.id}
            value={name}
            placeholder="Nombre..."
            autoComplete="off"
            onChange={event => api.rename(field.id, event.target.value)}
          />
        </div>
        <div className="pim-field pim-atributos-f-type">
          <label className="pim-label" htmlFor={`${baseId}-type`}>{T.fieldType}</label>
          <select
            id={`${baseId}-type`}
            className="pim-select"
            data-field-type=""
            data-field-id={field.id}
            value={field.type}
            onChange={event => api.changeType(field.id, event.target.value)}
            onKeyDown={event => radixSelectKeys(event, { typeahead: true })}
          >
            {FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div
          className="pim-field pim-atributos-f-value"
          role={isCheckbox ? 'group' : undefined}
          aria-labelledby={isCheckbox ? `${valueId}-label` : undefined}
        >
          {isCheckbox
            ? <span className="pim-label" id={`${valueId}-label`}>{T.fieldValue}</span>
            : <label className="pim-label" htmlFor={valueId}>{T.fieldValue}</label>}
          <div data-value-holder="" data-field-id={field.id}>
            <FieldValueControl field={field} id={valueId} onValue={value => api.setValue(field.id, value)} />
          </div>
        </div>
      </div>
      {field.type === 'select' ? (
        <div className="pim-field pim-atributos-options">
          <label className="pim-label" htmlFor={`${baseId}-options`}>{T.selectOptions}</label>
          {/* No controlado a propósito (E16): lo tecleado se queda tal cual y las opciones se derivan. */}
          <input
            id={`${baseId}-options`}
            className="pim-input"
            type="text"
            data-field-options=""
            data-field-id={field.id}
            defaultValue={(field.options || []).join(', ')}
            placeholder="Opción 1, Opción 2, Opción 3..."
            autoComplete="off"
            onChange={event => api.setOptionsText(field.id, event.target.value)}
          />
        </div>
      ) : null}
      <div className="pim-atributos-card-actions">
        {removeButton}
        <button
          type="button"
          className="pim-btn pim-btn-outline pim-btn-sm pim-atributos-confirm"
          data-action="confirm-field"
          data-field-id={field.id}
          disabled={!name.trim()}
          onClick={() => api.confirm(field.id)}
        >
          <Icon name="check" size={14} />
          {isNew ? T.confirmField : 'Confirmar'}
        </button>
      </div>
    </article>
  );
}
