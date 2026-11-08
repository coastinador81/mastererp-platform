import type { ComponentProps, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Interruptor (prototipo: <button role="switch" class="pim-switch">).
 * Nombre accesible con `label` (aria-label) o `aria-labelledby`.
 */
export interface SwitchProps extends Omit<ComponentProps<'button'>, 'onChange' | 'children'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
}

export function Switch({ checked, onCheckedChange, label, className, disabled, onClick, type = 'button', ...rest }: SwitchProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={clsx('pim-switch', className)}
      onClick={event => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(!checked);
      }}
      {...rest}
    />
  );
}

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'onChange'> {
  onCheckedChange?: (checked: boolean) => void;
  onChange?: ComponentProps<'input'>['onChange'];
  /** Texto al lado: envuelve la casilla en una etiqueta (.pim-row). */
  label?: ReactNode;
  labelClassName?: string;
}

/** Casilla (.pim-check, 16 px, color de acento azul). */
export function Checkbox({ onCheckedChange, onChange, label, labelClassName, className, ...rest }: CheckboxProps) {
  const input = (
    <input
      type="checkbox"
      className={clsx('pim-check', className)}
      onChange={event => {
        onChange?.(event);
        onCheckedChange?.(event.target.checked);
      }}
      {...rest}
    />
  );
  if (label === undefined) return input;
  return (
    <label className={clsx('pim-row', labelClassName)}>
      {input}
      <span>{label}</span>
    </label>
  );
}
