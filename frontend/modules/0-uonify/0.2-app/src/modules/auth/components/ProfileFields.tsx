import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { Option } from '../model/options';
import type { ProfileValues } from '../model/types';
import { setProfileValue, useAuthUi } from '../state/authUi';

type TextKey = Exclude<keyof ProfileValues, 'plan'>;

interface FieldShellProps {
  id: string;
  label: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

/** Campo del alta: etiqueta + control (prototipo: .uon-onboard-field). */
export function FieldShell({ id, label, wide, children }: FieldShellProps) {
  return (
    <div className={clsx('uon-onboard-field', wide && 'uon-onboard-field-wide')}>
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/** «(opcional)» en gris, dentro de la etiqueta. */
export const Optional = () => <span>(opcional)</span>;

interface TextFieldProps {
  id: string;
  name: TextKey;
  type?: 'text' | 'email';
  autoComplete: string;
  maxLength: number;
  placeholder: string;
  required?: boolean;
  readOnly?: boolean;
  describedBy?: string;
  /** Recibe el foco al llegar al paso. */
  stepFocus?: boolean;
}

export function TextInput({ id, name, type = 'text', describedBy, stepFocus, ...rest }: TextFieldProps) {
  const value = useAuthUi(state => state.profile.values[name]);
  return (
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      aria-describedby={describedBy}
      data-step-focus={stepFocus || undefined}
      onChange={event => setProfileValue(name, event.target.value)}
      {...rest}
    />
  );
}

interface SelectInputProps {
  id: string;
  name: TextKey;
  options: readonly Option[];
  required?: boolean;
  describedBy?: string;
  stepFocus?: boolean;
}

export function SelectInput({ id, name, options, required, describedBy, stepFocus }: SelectInputProps) {
  const value = useAuthUi(state => state.profile.values[name]);
  return (
    <select
      id={id}
      name={name}
      required={required}
      value={value}
      aria-describedby={describedBy}
      data-step-focus={stepFocus || undefined}
      onChange={event => setProfileValue(name, event.target.value)}
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
