import { Children, type ComponentProps, type ElementType, type ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Datos pequeños (prototipo: .pim-meta y .pim-kv de pim/core.css).
 */

export interface MetaProps extends ComponentProps<'div'> {
  /** Cada elemento es un dato; se separan con «·». También vale pasar hijos. */
  items?: ReactNode[];
  as?: ElementType;
}

/** Línea de metadatos: datos breves en gris separados por un punto. */
export function Meta({ items, as: Tag = 'div', className, children, ...rest }: MetaProps) {
  const list = items ?? Children.toArray(children);
  return (
    <Tag className={clsx('pim-meta', className)} {...rest}>
      {list.filter(item => item !== null && item !== undefined && item !== false && item !== '').map((item, index) => (
        <span key={index}>{item}</span>
      ))}
    </Tag>
  );
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Valor en monoespaciada (SKU, ASIN, ids…). */
  mono?: boolean;
}

export interface KeyValueProps extends ComponentProps<'dl'> {
  items: KeyValueItem[];
}

/** Lista clave-valor (detalles técnicos, puntuaciones, configuración). */
export function KeyValue({ items, className, ...rest }: KeyValueProps) {
  return (
    <dl className={clsx('pim-kv', className)} {...rest}>
      {items.map((item, index) => (
        <div key={index} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'pim-mono' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
