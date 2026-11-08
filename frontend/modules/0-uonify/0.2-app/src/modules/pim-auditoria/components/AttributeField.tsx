import clsx from 'clsx';
import type { ReactNode } from 'react';
import { display, isTechnicalKey } from '../model/translations';

export interface AttributeFieldProps {
  id: string;
  label: string;
  /** Clave de Amazon que se edita. */
  attrKey: string;
  /** Prefijo de `data-focus` («missing» o «attr»). */
  focusKey: string;
  value: unknown;
  badge: ReactNode;
  missing?: boolean;
  onChange: (key: string, value: string) => void;
}

/** Un atributo de Amazon editable (E13: 0 y false se ven). */
export function AttributeField({ id, label, attrKey, focusKey, value, badge, missing = false, onChange }: AttributeFieldProps) {
  return (
    <div className={clsx('pim-field pim-auditoria-attr', missing && 'pim-auditoria--missing')}>
      <div className="pim-label">
        <label className="pim-auditoria-attr-label" htmlFor={id}>{label}</label>
        {badge}
      </div>
      <input
        id={id}
        className={clsx('pim-input pim-auditoria-attr-input', isTechnicalKey(attrKey) && 'pim-mono')}
        type="text"
        data-focus={`${focusKey}:${attrKey}`}
        value={display(value)}
        placeholder="Valor..."
        onChange={event => onChange(attrKey, event.target.value)}
      />
    </div>
  );
}
