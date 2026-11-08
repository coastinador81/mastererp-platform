import type { ReactNode } from 'react';
import clsx from 'clsx';

/** Desglose de un cobro o una devolución: líneas y total (como el resumen de Stripe). */
export interface AmountLine {
  label: ReactNode;
  value: ReactNode;
  /** Nota pequeña bajo la etiqueta. */
  note?: ReactNode;
  tone?: 'muted' | 'discount';
}

export interface AmountLinesProps {
  lines: AmountLine[];
  total: { label: ReactNode; value: ReactNode };
  className?: string;
  'aria-label'?: string;
}

export function AmountLines({ lines, total, className, ...rest }: AmountLinesProps) {
  return (
    <dl className={clsx('bil-lines', className)} {...rest}>
      {lines.map((line, index) => (
        <div key={index} className={clsx('bil-line', line.tone && `is-${line.tone}`)}>
          <dt>
            {line.label}
            {line.note ? <small>{line.note}</small> : null}
          </dt>
          <dd className="pim-mono">{line.value}</dd>
        </div>
      ))}
      <div className="bil-line is-total">
        <dt>{total.label}</dt>
        <dd className="pim-mono">{total.value}</dd>
      </div>
    </dl>
  );
}
