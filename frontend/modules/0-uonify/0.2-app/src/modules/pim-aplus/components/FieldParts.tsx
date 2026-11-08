import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';

/**
 * Piezas comunes de los editores A+: etiqueta arriba (nombre a la izquierda y
 * límite apagado a la derecha) y contador debajo, como el prototipo.
 */
export function Limit({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <span className={clsx('pim-aplus-limit', mono && 'pim-mono')}>{children}</span>;
}

export function LabelText({ children }: { children: ReactNode }) {
  return <span className="pim-aplus-label-text">{children}</span>;
}

export interface CounterRowProps {
  id: string;
  length: number;
  max: number;
  suffix?: string;
  /** Aviso solo con icono (cuatro imágenes). */
  iconOnly?: boolean;
  /** Solo el contador (rojo al pasarse), sin «Excede el límite». */
  noWarn?: boolean;
}

export function CounterRow({ id, length, max, suffix = '', iconOnly = false, noWarn = false }: CounterRowProps) {
  const over = length > max;
  return (
    <div className="pim-aplus-counter-row" id={id}>
      <span className={clsx('pim-counter', over && 'is-over')}>{`${length}/${max}${suffix}`}</span>
      {over && !noWarn ? (
        <span className="pim-aplus-over">
          <Icon name="alert-triangle" size={12} />
          {iconOnly ? <span className="pim-sr-only">Excede el límite</span> : 'Excede el límite'}
        </span>
      ) : null}
    </div>
  );
}

/** Clases y atributos de un campo que se pasa de su límite. */
export function invalidProps(over: boolean, base: string, extra?: string) {
  return { className: clsx(base, extra, over && 'is-invalid'), 'aria-invalid': over || undefined };
}
