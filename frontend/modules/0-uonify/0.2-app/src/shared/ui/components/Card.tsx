import type { ComponentProps, ElementType, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

/** Tarjeta (.pim-card, radio 12): profundidad por superficie, no por sombra. */
export type CardVariant = 'default' | 'soft' | 'dashed' | 'ai';

export interface CardProps extends ComponentProps<'div'> {
  variant?: CardVariant;
  /** Elemento raíz: div (por defecto), section, article… */
  as?: ElementType;
  children?: ReactNode;
}

export function Card({ variant = 'default', as: Tag = 'div', className, children, ...rest }: CardProps) {
  return (
    <Tag className={clsx('pim-card', variant !== 'default' && `pim-card-${variant}`, className)} {...rest}>
      {children}
    </Tag>
  );
}

export interface CardTitleProps extends ComponentProps<'h3'> {
  icon?: IconName;
  as?: ElementType;
  children?: ReactNode;
}

/** Título de tarjeta (.pim-card-title) con icono opcional. */
export function CardTitle({ icon, as: Tag = 'h3', className, children, ...rest }: CardTitleProps) {
  return (
    <Tag className={clsx('pim-card-title', className)} {...rest}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </Tag>
  );
}
