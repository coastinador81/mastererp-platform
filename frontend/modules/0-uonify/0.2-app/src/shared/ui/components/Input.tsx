import type { ComponentProps, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Controles de texto y selección (prototipo: .pim-input, .pim-textarea y
 * .pim-select, radio 8). `invalid` pinta el borde de error; `mono` usa la
 * monoespaciada para datos técnicos (SKU, ASIN, EAN, URLs).
 */

interface ControlExtras {
  invalid?: boolean;
  mono?: boolean;
}

export type InputProps = ComponentProps<'input'> & ControlExtras;

export function Input({ invalid = false, mono = false, className, type = 'text', ...rest }: InputProps) {
  return (
    <input
      type={type}
      className={clsx('pim-input', mono && 'pim-mono', invalid && 'is-invalid', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export type TextareaProps = ComponentProps<'textarea'> & ControlExtras;

export function Textarea({ invalid = false, mono = false, className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={clsx('pim-textarea', mono && 'pim-mono', invalid && 'is-invalid', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps extends ComponentProps<'select'> {
  /** Opciones; también se pueden pasar <option> como hijos. */
  options?: SelectOption[];
  /** Primera opción vacía («Selecciona…»). */
  placeholder?: string;
  invalid?: boolean;
}

export function Select({ options, placeholder, invalid = false, className, children, ...rest }: SelectProps) {
  return (
    <select className={clsx('pim-select', invalid && 'is-invalid', className)} aria-invalid={invalid || undefined} {...rest}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options?.map(option => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
      {children}
    </select>
  );
}
