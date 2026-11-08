import type { ReactNode } from 'react';
import { Icon } from '@/shared/ui';

/** Cabecera de sección plana del prototipo: título (h3 con icono) a la izquierda, acciones a la derecha. */
export function AtrSectionHead({ id, icon, title, actions }: { id: string; icon: string; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="pim-section-head">
      <h3 className="pim-section-title" id={id}>
        <Icon name={icon} size={16} />
        {title}
      </h3>
      {actions ? <div className="pim-section-actions">{actions}</div> : null}
    </div>
  );
}
