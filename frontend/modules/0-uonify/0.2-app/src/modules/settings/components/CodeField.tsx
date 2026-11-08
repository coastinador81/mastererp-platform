import { Field, Input } from '@/shared/ui';
import { normalizeCode } from '../model/security';

export interface CodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  /** Recibe el foco al abrir el diálogo. */
  autoFocus?: boolean;
  /** id del campo (para darle el foco cuando aparece después de abrir el diálogo). */
  inputId?: string;
}

/** Campo de código de 6 cifras (teclado numérico y autocompletado del SMS o del correo). */
export function CodeField({ value, onChange, label = 'Código de 6 cifras', hint, error, disabled, autoFocus, inputId }: CodeFieldProps) {
  return (
    <Field label={label} hint={hint} error={error ?? undefined}>
      <Input
        id={inputId}
        mono
        className="uset-code-input"
        value={value}
        onChange={event => onChange(normalizeCode(event.target.value))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        placeholder="123456"
        disabled={disabled}
        data-autofocus={autoFocus ? '' : undefined}
        invalid={Boolean(error)}
      />
    </Field>
  );
}
