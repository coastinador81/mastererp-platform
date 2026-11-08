import type { ComponentProps, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

/**
 * Insignia (.pim-badge, radio 4). Color solo cuando afirma algo:
 * azul información, verde éxito, ámbar aviso, rojo error, `ai` lo que hace Uony.
 */
export type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'ai' | 'purple' | 'outline';

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
  icon?: IconName;
  children?: ReactNode;
}

export function Badge({ tone = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={clsx('pim-badge', tone !== 'neutral' && `pim-badge-${tone}`, className)} {...rest}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export interface AiMarkProps extends ComponentProps<'span'> {
  icon?: IconName;
  iconSize?: number;
  children?: ReactNode;
}

/**
 * Marca de IA junto a un título o un resultado (.pim-ai-mark). Sin texto es
 * decorativa (aria-hidden), como en el prototipo.
 */
export function AiMark({ icon = 'sparkles', iconSize = 12, className, children, ...rest }: AiMarkProps) {
  const decorative = children === undefined || children === null || children === false;
  return (
    <span className={clsx('pim-ai-mark', className)} aria-hidden={decorative || undefined} {...rest}>
      <Icon name={icon} size={iconSize} />
      {children}
    </span>
  );
}
