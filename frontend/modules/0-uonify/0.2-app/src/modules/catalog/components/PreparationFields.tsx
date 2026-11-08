import { useId } from 'react';
import type { PreparationField } from '../api/preparation';

interface Props { fields: PreparationField[]; answers: Record<string, string>; onChange: (id: string, value: string) => void }

export function PreparationFields({ fields, answers, onChange }: Props) {
  const prefix = useId();
  return <div className="product-preparation-fields">{fields.map(field => <label key={field.id} htmlFor={`${prefix}-${field.id}`}>
    <span>{field.label}{field.required && <small>Obligatorio</small>}</span>
    {field.type === 'select' ? <select id={`${prefix}-${field.id}`} value={answers[field.id] ?? ''} required={field.required} onChange={event => onChange(field.id, event.target.value)}>
      <option value="">Sin indicar</option>
      {field.options?.map(option => <option value={option} key={option}>{option}</option>)}
    </select> : field.type === 'textarea' ? <textarea id={`${prefix}-${field.id}`} rows={3} maxLength={3000} required={field.required} value={answers[field.id] ?? ''} onChange={event => onChange(field.id, event.target.value)} />
      : <input id={`${prefix}-${field.id}`} type="text" maxLength={3000} required={field.required} value={answers[field.id] ?? ''} onChange={event => onChange(field.id, event.target.value)} />}
  </label>)}</div>;
}
