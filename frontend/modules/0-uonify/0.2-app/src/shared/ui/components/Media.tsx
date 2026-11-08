import type { ComponentProps, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

/**
 * Pasos, miniaturas y opciones (prototipo: .pim-stepper, .pim-thumb y
 * .pim-option de pim/core.css).
 */

export type StepState = 'pending' | 'active' | 'done';

export interface StepItem {
  label: ReactNode;
  /** Texto destacado dentro del paso (se pinta en <strong>). */
  title?: ReactNode;
  state?: StepState;
}

export interface StepperProps extends Omit<ComponentProps<'ol'>, 'children'> {
  steps: StepItem[];
  /** Índice del paso en curso: los anteriores quedan hechos (si no se da `state`). */
  current?: number;
}

/** Pasos numerados de un flujo (Auditoría, generación 3D…). */
export function Stepper({ steps, current, className, ...rest }: StepperProps) {
  return (
    <ol className={clsx('pim-stepper', className)} {...rest}>
      {steps.map((step, index) => {
        const state: StepState = step.state
          ?? (current === undefined ? 'pending' : index < current ? 'done' : index === current ? 'active' : 'pending');
        return (
          <li
            key={index}
            className={clsx('pim-step', state === 'active' && 'is-active', state === 'done' && 'is-done')}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            {step.title ? <strong>{step.title}</strong> : null}
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

export interface ThumbProps extends Omit<ComponentProps<'div'>, 'children'> {
  src?: string;
  alt?: string;
  selected?: boolean;
  /** Acciones de icono que aparecen al pasar el ratón o con el foco. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** Miniatura cuadrada con acciones superpuestas. */
export function Thumb({ src, alt = '', selected = false, actions, className, children, ...rest }: ThumbProps) {
  return (
    <div className={clsx('pim-thumb', selected && 'is-selected', className)} {...rest}>
      {src ? <img src={src} alt={alt} loading="lazy" decoding="async" /> : null}
      {children}
      {actions ? <div className="pim-thumb-actions">{actions}</div> : null}
    </div>
  );
}

export interface OptionTileProps extends Omit<ComponentProps<'button'>, 'title'> {
  selected?: boolean;
  /** `pressed` (aria-pressed, por defecto) o `radio` (role radio + aria-checked). */
  mode?: 'pressed' | 'radio';
  title?: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  children?: ReactNode;
}

/** Opción única entre tarjetas (categorías, tipos de módulo, estilos). */
export function OptionTile({
  selected = false,
  mode = 'pressed',
  title,
  description,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: OptionTileProps) {
  const state = mode === 'radio' ? { role: 'radio' as const, 'aria-checked': selected } : { 'aria-pressed': selected };
  return (
    <button type={type} className={clsx('pim-option', className)} {...state} {...rest}>
      {title ? (
        <strong className="pim-row">
          {icon ? <Icon name={icon} size={16} /> : null}
          {title}
        </strong>
      ) : null}
      {description ? <small>{description}</small> : null}
      {children}
    </button>
  );
}
