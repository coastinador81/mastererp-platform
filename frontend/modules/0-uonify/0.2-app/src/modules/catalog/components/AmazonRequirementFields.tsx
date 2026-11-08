import { useId } from 'react';
import { customerText, customerSource } from '@/shared/lib/customerText';
import type { AmazonRequirementField } from '../api/amazonRequirements';

interface Props { fields: AmazonRequirementField[]; answers: Record<string, string>; onChange: (id: string, value: string) => void }
export function AmazonRequirementFields({ fields, answers, onChange }: Props) {
  const prefix = useId();
  return <div className="product-preparation-fields">{fields.map(field => {
    const id = `${prefix}-${field.id}`;
    const value = answers[field.id] ?? field.value ?? '';
    return <div className="amazon-requirement-field" key={field.id}>
      <label htmlFor={id}><span>{field.label}{field.required && <small>Obligatorio</small>}</span>
        {field.type === 'select' && field.closed !== false ? <select id={id} value={value} required={field.required} aria-describedby={field.hint ? `${id}-hint` : undefined} onChange={event => onChange(field.id, event.target.value)}>
          <option value="">Selecciona una opción</option>{value && !field.options?.includes(value) && <option value={value}>Valor anterior: {value}</option>}
          {field.options?.map(option => <option value={option} key={option}>{option}</option>)}
        </select> : field.type === 'textarea' ? <textarea id={id} rows={3} maxLength={3000} value={value} required={field.required} aria-describedby={field.hint ? `${id}-hint` : undefined} onChange={event => onChange(field.id, event.target.value)} />
          : <input id={id} type="text" value={value} maxLength={Math.min(field.validation?.maxLength ?? 3000, 3000)} required={field.required}
            inputMode={field.validation?.number ? 'decimal' : undefined} list={field.type === 'select' ? `${id}-options` : undefined}
            aria-describedby={field.hint ? `${id}-hint` : undefined} onChange={event => onChange(field.id, event.target.value)} />}
      </label>
      {field.type === 'select' && field.closed === false && <datalist id={`${id}-options`}>{field.options?.map(option => <option value={option} key={option} />)}</datalist>}
      {field.hint && <p id={`${id}-hint`} className="amazon-requirements-hint">{customerText(field.hint)}</p>}
      {field.suggestion && <div className="amazon-requirements-suggestion"><p>Sugerencia: <strong>{field.suggestion.value}</strong><span>{customerSource(field.suggestion.source)}</span></p>
        <button type="button" onClick={() => onChange(field.id, field.suggestion!.value)}>Usar sugerencia</button></div>}
    </div>;
  })}</div>;
}
