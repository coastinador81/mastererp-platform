import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../icons/Icon';

interface Props { children: ReactNode; label?: string; className?: string }

/** Aclaraciones opcionales. Los errores, requisitos y consentimientos siguen visibles. */
export function InformationDisclosure({ children, label = 'Más información', className = '' }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <div className={`pim-information ${className}`}>
    <button type="button" className="pim-information-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <Icon name="info" size={14} /><span>{open ? `Ocultar: ${label.toLowerCase()}` : label}</span>
    </button>
    <div id={id} className="pim-information-content" hidden={!open}>{children}</div>
  </div>;
}
