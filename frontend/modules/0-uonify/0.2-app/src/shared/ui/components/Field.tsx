import { Children, cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Campo de formulario (prototipo: .pim-field, .pim-label, .pim-hint,
 * .pim-error-text y .pim-counter de pim/core.css).
 */

export interface LabelProps extends ComponentProps<'label'> {
  /** Contenido a la derecha de la etiqueta (contador, acción pequeña…). */
  aside?: ReactNode;
}

export function Label({ className, aside, children, ...rest }: LabelProps) {
  return (
    <label className={clsx('pim-label', className)} {...rest}>
      {aside === undefined ? children : <span>{children}</span>}
      {aside}
    </label>
  );
}

/** Ayuda bajo un control (.pim-hint). Es un span: dentro de .pim-field no suma márgenes. */
export function Hint({ className, ...rest }: ComponentProps<'span'>) {
  return <span className={clsx('pim-hint', className)} {...rest} />;
}

/** Error de un campo (.pim-error-text), anunciado al aparecer. */
export function ErrorText({ className, ...rest }: ComponentProps<'span'>) {
  return <span className={clsx('pim-error-text', className)} role="alert" {...rest} />;
}

export interface CounterProps extends ComponentProps<'span'> {
  value: number;
  max: number;
}

/** Contador «123/200» que se pone en rojo al pasarse (.pim-counter.is-over). */
export function Counter({ value, max, className, ...rest }: CounterProps) {
  return (
    <span className={clsx('pim-counter', value > max && 'is-over', className)} {...rest}>
      {value}/{max}
    </span>
  );
}

export interface FieldProps extends Omit<ComponentProps<'div'>, 'children'> {
  label?: ReactNode;
  /** Contenido a la derecha de la etiqueta (p. ej. <Counter/>). */
  labelAside?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** id del control; si no se da, se genera y se pasa al hijo único. */
  htmlFor?: string;
  children: ReactNode;
}

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' };

/**
 * Etiqueta + control + ayuda + error. Si el hijo es un único control, recibe
 * el id de la etiqueta, aria-describedby (ayuda y error) y aria-invalid.
 */
export function Field({ label, labelAside, hint, error, htmlFor, className, children, ...rest }: FieldProps) {
  const auto = useId();
  const only = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<ControlProps>) : null;
  const controlId = htmlFor ?? only?.props.id ?? `${auto}-control`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [only?.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;
  const wiring: ControlProps = { id: controlId };
  if (describedBy) wiring['aria-describedby'] = describedBy;
  if (error) wiring['aria-invalid'] = true;
  const control = only ? cloneElement(only, wiring) : children;
  return (
    <div className={clsx('pim-field', className)} {...rest}>
      {label !== undefined ? <Label htmlFor={controlId} aside={labelAside}>{label}</Label> : null}
      {control}
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
      {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
    </div>
  );
}
