import type { ComponentProps } from 'react';
import clsx from 'clsx';
import { clamp } from '@/shared/lib';
import { Icon } from '../icons/Icon';

/**
 * Barra de progreso (prototipo: .pim-progress, con role="progressbar").
 * `ai` usa el relleno azul → aqua reservado a lo que hace Uony.
 */
export interface ProgressProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** 0-100. */
  value: number;
  /** Nombre accesible (p. ej. «Generando Modelo 3D con IA»). */
  label: string;
  ai?: boolean;
}

export function Progress({ value, label, ai = false, className, ...rest }: ProgressProps) {
  const width = clamp(Number.isFinite(value) ? value : 0, 0, 100);
  return (
    <div
      className={clsx('pim-progress', ai && 'pim-progress-ai', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      {...rest}
    >
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export interface SpinnerProps {
  size?: number;
  /** Texto para lectores de pantalla («Cargando…»). Sin él es decorativo. */
  label?: string;
  className?: string;
}

/** Icono «loader» girando (.pim-spin). */
export function Spinner({ size = 16, label, className }: SpinnerProps) {
  if (!label) return <Icon name="loader" size={size} className={clsx('pim-spin', className)} />;
  return (
    <span role="status" className={className}>
      <Icon name="loader" size={size} className="pim-spin" />
      <span className="pim-sr-only">{label}</span>
    </span>
  );
}
