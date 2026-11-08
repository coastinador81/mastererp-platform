import { fieldText } from '../model/fields';
import type { CustomField } from '../model/types';

/** Control del valor de un campo según su tipo (renderCustomFieldInput del original). */
export function FieldValueControl({ field, id, onValue }: {
  field: CustomField;
  id: string;
  onValue: (value: CustomField['value']) => void;
}) {
  const text = fieldText(field.value);
  const common = { id, 'data-field-value': '', 'data-field-id': field.id };
  switch (field.type) {
    case 'number':
      return <input {...common} className="pim-input" type="number" value={text} placeholder="0" onChange={event => onValue(event.target.value)} />;
    case 'textarea':
      return <textarea {...common} className="pim-textarea pim-atributos-textarea" placeholder="Texto largo..." value={text} onChange={event => onValue(event.target.value)} />;
    case 'select': {
      const options = Array.isArray(field.options) ? field.options : [];
      const known = options.includes(text);
      return (
        <select {...common} className="pim-select" value={known ? text : ''} onChange={event => onValue(event.target.value)}>
          <option value="" disabled hidden>Seleccionar...</option>
          {options.map((option, index) => <option key={`${index}-${option}`} value={option}>{option}</option>)}
        </select>
      );
    }
    case 'checkbox':
      return (
        <label className="pim-atributos-check">
          <input {...common} className="pim-check" type="checkbox" checked={Boolean(field.value)} onChange={event => onValue(event.target.checked)} />
          <span>Activado</span>
        </label>
      );
    case 'date':
      return <input {...common} className="pim-input" type="date" value={text} onChange={event => onValue(event.target.value)} />;
    default:
      return <input {...common} className="pim-input" type="text" value={text} placeholder="Valor..." onChange={event => onValue(event.target.value)} />;
  }
}
