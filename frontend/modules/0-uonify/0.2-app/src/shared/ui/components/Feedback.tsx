import type { ComponentProps, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

/**
 * Estado vacío y alertas (prototipo: .pim-empty y .pim-alert de pim/core.css).
 */

export interface EmptyProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon?: IconName;
  title?: ReactNode;
  description?: ReactNode;
  /** Acción u otro contenido debajo del texto. */
  children?: ReactNode;
}

/** Estado vacío: icono gris, título y una línea de contexto. */
export function Empty({ icon = 'box', title, description, className, children, ...rest }: EmptyProps) {
  return (
    <div className={clsx('pim-empty', className)} {...rest}>
      <Icon name={icon} size={24} />
      {title ? <strong>{title}</strong> : null}
      {description ? <span>{description}</span> : null}
      {children}
    </div>
  );
}

/** Tono semántico: solo comunica estado. `ai` es lo que hace Uony. */
export type AlertTone = 'info' | 'amber' | 'green' | 'red' | 'ai';

const ALERT_ICONS: Record<AlertTone, IconName> = {
  info: 'info',
  amber: 'alert-triangle',
  green: 'check-circle',
  red: 'x-circle',
  ai: 'sparkles',
};

export interface AlertProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: AlertTone;
  /** Icono propio; `null` lo quita. */
  icon?: IconName | null;
  title?: ReactNode;
  children?: ReactNode;
}

/**
 * Alerta (.pim-alert + .pim-alert-<tono>). El rol lo decide quien la usa:
 * `role="alert"` para errores que deben anunciarse, `status` o `note` para el resto.
 */
export function Alert({ tone = 'info', icon, title, className, children, ...rest }: AlertProps) {
  const name = icon === null ? null : (icon ?? ALERT_ICONS[tone]);
  return (
    <div className={clsx('pim-alert', tone !== 'info' && `pim-alert-${tone}`, className)} {...rest}>
      {name ? <Icon name={name} size={16} /> : null}
      <div>
        {title ? <strong style={{ display: 'block' }}>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}
