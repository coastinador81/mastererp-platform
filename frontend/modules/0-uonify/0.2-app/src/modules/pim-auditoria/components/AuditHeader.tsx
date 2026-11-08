import { useId } from 'react';
import { Icon } from '@/shared/ui';

/** Cabecera de la pestaña (E02): el cerebro es estructura, en azul. */
export function AuditHeader() {
  const titleId = useId();
  return (
    <header className="pim-head">
      <h2 id={titleId}>
        <Icon name="brain" size={18} className="pim-auditoria-head-icon" />
        <span>Auditoría IA Inteligente</span>
      </h2>
      <p>Extrae, categoriza y valida datos automáticamente con Uony</p>
    </header>
  );
}
