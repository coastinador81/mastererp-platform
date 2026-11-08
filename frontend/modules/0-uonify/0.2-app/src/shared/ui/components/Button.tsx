import type { ComponentProps, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

/**
 * Botones del kit (prototipo: .pim-btn de pim/core.css). Un solo botón sólido
 * (`primary`) por vista; las acciones de la IA (Uony) usan `ai`.
 */
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'soft' | 'ai' | 'plain';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type TooltipPos = 'above' | 'below' | 'right';
export type TooltipAlign = 'start' | 'end';

export interface TooltipProps {
  /** Texto del tooltip [data-tooltip] (nombre al pasar el ratón y con el foco). */
  tooltip?: string;
  tooltipPos?: TooltipPos;
  tooltipAlign?: TooltipAlign;
}

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'children'>, TooltipProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ocupa todo el ancho (.pim-btn-block). */
  block?: boolean;
  /** Icono antes del texto. */
  icon?: IconName;
  /** Icono después del texto. */
  iconEnd?: IconName;
  /** Muestra el spinner en lugar del icono y marca el botón como ocupado. */
  loading?: boolean;
  children?: ReactNode;
}

/** Clases de un botón del kit, para enlaces o etiquetas con aspecto de botón. */
export function buttonClass(variant: ButtonVariant = 'outline', size: ButtonSize = 'md', extra?: string): string {
  return clsx('pim-btn', variant !== 'plain' && `pim-btn-${variant}`, size !== 'md' && `pim-btn-${size}`, extra);
}

/** Atributos data-tooltip* listos para esparcir en cualquier elemento. */
export function tooltipAttrs({ tooltip, tooltipPos, tooltipAlign }: TooltipProps): Record<string, string | undefined> {
  if (!tooltip) return {};
  return {
    'data-tooltip': tooltip,
    'data-tooltip-pos': tooltipPos,
    'data-tooltip-align': tooltipAlign,
  };
}

export function Button({
  variant = 'outline',
  size = 'md',
  block = false,
  icon,
  iconEnd,
  loading = false,
  tooltip,
  tooltipPos,
  tooltipAlign,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const iconSize = size === 'sm' ? 14 : 16;
  return (
    <button
      type={type}
      className={clsx(buttonClass(variant, size), block && 'pim-btn-block', className)}
      aria-busy={loading || undefined}
      {...tooltipAttrs({ tooltip, tooltipPos, tooltipAlign })}
      {...rest}
    >
      {loading ? <Icon name="loader" size={iconSize} className="pim-spin" /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} size={iconSize} /> : null}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'iconEnd' | 'children' | 'block' | 'tooltip'> {
  icon: IconName;
  /** Nombre accesible (aria-label) y, salvo `tooltip={false}`, texto del tooltip. */
  label: string;
  tooltip?: string | false;
  iconSize?: number;
}

/** Botón solo icono (.pim-btn-icon, fantasma por defecto) con nombre y tooltip. */
export function IconButton({
  icon,
  label,
  tooltip,
  variant = 'ghost',
  size = 'md',
  iconSize,
  loading = false,
  tooltipPos,
  tooltipAlign,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const pixels = iconSize ?? (size === 'sm' ? 14 : 16);
  const text = tooltip === false ? undefined : (tooltip ?? label);
  return (
    <button
      type={type}
      className={clsx(buttonClass(variant, size === 'lg' ? 'md' : size), 'pim-btn-icon', className)}
      aria-label={label}
      aria-busy={loading || undefined}
      {...tooltipAttrs({ tooltip: text, tooltipPos, tooltipAlign })}
      {...rest}
    >
      <Icon name={loading ? 'loader' : icon} size={pixels} className={loading ? 'pim-spin' : undefined} />
    </button>
  );
}

export interface LinkButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  children?: ReactNode;
}

/** Acción con aspecto de enlace (.pim-link). */
export function LinkButton({ className, type = 'button', ...rest }: LinkButtonProps) {
  return <button type={type} className={clsx('pim-link', className)} {...rest} />;
}
