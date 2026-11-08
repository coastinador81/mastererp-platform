import clsx from 'clsx';
import type { SchemaField } from '../model/types';
import { display, isTechnicalKey } from '../model/translations';

export interface SchemaFieldControlProps {
  field: string;
  value: unknown;
  schema: SchemaField | undefined;
  inputId: string;
  onChange: (field: string, value: unknown) => void;
}

/** Control de un campo del esquema según su tipo: lista, interruptor o texto. */
export function SchemaFieldControl({ field, value, schema, inputId, onChange }: SchemaFieldControlProps) {
  if (schema?.type === 'select') {
    const current = display(value);
    const options = Array.isArray(schema.options) ? schema.options : [];
    return (
      <select
        id={inputId}
        className="pim-select"
        data-focus={`ef:${field}`}
        value={options.includes(current) ? current : ''}
        onChange={event => onChange(field, event.target.value)}
      >
        <option value="" disabled hidden>Seleccionar...</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (schema?.type === 'boolean') {
    const checked = Boolean(value);
    return (
      <div className="pim-row">
        <button
          type="button"
          id={inputId}
          role="switch"
          className="pim-switch"
          aria-checked={checked}
          aria-labelledby={`${inputId}-name`}
          data-focus={`ef:${field}`}
          onClick={() => onChange(field, !checked)}
        />
        <span className="pim-hint">{checked ? 'Sí' : 'No'}</span>
      </div>
    );
  }
  return (
    <input
      id={inputId}
      className={clsx('pim-input', isTechnicalKey(field) && 'pim-mono')}
      type="text"
      inputMode={schema?.type === 'number' ? 'decimal' : undefined}
      data-focus={`ef:${field}`}
      value={display(value)}
      placeholder={schema?.description || 'Valor...'}
      onChange={event => onChange(field, event.target.value)}
    />
  );
}
