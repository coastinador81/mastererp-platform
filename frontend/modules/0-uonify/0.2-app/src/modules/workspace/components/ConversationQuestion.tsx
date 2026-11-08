import { useId, useLayoutEffect, useRef } from 'react';
import { customerText, customerSource } from '@/shared/lib/customerText';
import type { ConversationField } from '../model/conversationForm';
import { ConversationResourceEvidence } from './ConversationResourceEvidence';

interface Props { field: ConversationField; value: string; custom: boolean; disabled: boolean; allowCustom?: boolean; compact?: boolean; change: (value: string, custom?: boolean) => void; focusRequested?: boolean; onFocusHandled?: () => void }

export function ConversationQuestion({ field, value, custom, disabled, allowCustom = true, compact = false, change, focusRequested = false, onFocusHandled }: Props) {
  const id = useId();
  const root = useRef<HTMLFieldSetElement>(null);
  useLayoutEffect(() => {
    if (disabled || !focusRequested) return;
    (root.current?.querySelector<HTMLElement>('input:checked') ?? root.current?.querySelector<HTMLElement>('input,textarea,select'))?.focus({ preventScroll: true });
    onFocusHandled?.();
  }, [disabled, focusRequested, onFocusHandled]);
  return <fieldset ref={root} className="uony-question-field" disabled={disabled}>
    <legend>{customerText(field.label)}{!field.required && <small>Opcional</small>}</legend>
    {field.hint && <p className="uony-question-hint" id={`${id}-hint`}>{customerText(field.hint)}</p>}
    {field.resourceEvidence && <ConversationResourceEvidence evidence={field.resourceEvidence} />}
    {field.suggestion && <div className="uony-question-suggestion"><p>Sugerencia: <strong>{field.suggestion.value}</strong><small>{customerSource(field.suggestion.source)}</small></p>
      <button type="button" onClick={() => change(field.suggestion!.value, field.type === 'select' && !field.options?.includes(field.suggestion!.value))}>Usar sugerencia</button></div>}
    {field.type === 'select' ? <>
      {(field.options?.length ?? 0) > 8 ? <select aria-label={field.label} aria-describedby={field.hint ? `${id}-hint` : undefined}
        value={custom ? '' : value} onChange={event => change(event.target.value)}><option value="">Selecciona una opción</option>
        {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
      </select> : <div className="uony-question-options">
        {field.options?.map((option, index) => <label className={!custom && value === option ? 'is-selected' : ''} key={option}>
          <input type="radio" name={id} value={option} checked={!custom && value === option} onChange={() => change(option)} />
          <span className="uony-question-option-number" aria-hidden="true">{index + 1}</span><span>{option}</span>
        </label>)}
      </div>}
      {allowCustom && !field.closed && <label className="uony-question-free" htmlFor={`${id}-free`}><span className={compact ? '' : 'sr-only'}>{compact ? 'O escribe tu respuesta' : 'Tu respuesta'}</span>
        <textarea id={`${id}-free`} rows={1} value={custom ? value : ''} maxLength={3000}
          placeholder={compact ? 'Tu respuesta' : 'O escribe tu propia respuesta…'} onChange={event => change(event.target.value, true)} />
      </label>}
    </> : <label className="uony-question-free" htmlFor={`${id}-value`}>
      <span className="sr-only">{field.label}</span>
      {field.type === 'textarea' ? <textarea id={`${id}-value`} rows={3} maxLength={3000} value={value} onChange={event => change(event.target.value)} />
        : <input id={`${id}-value`} type="text" inputMode={field.validation?.number ? 'decimal' : undefined} maxLength={Math.min(field.validation?.maxLength ?? 3000, 3000)} value={value} onChange={event => change(event.target.value)} />}
    </label>}
  </fieldset>;
}
