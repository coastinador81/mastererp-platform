import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/shared/ui';
import { useMastererp } from '../hooks/useMastererp';
import { ErpConnectionCard } from './ErpConnectionCard';
import { FinanceIcon } from './FinanceMenu';
import '../styles/connection.css';

/**
 * Tarjeta del ERP en la conversación (show_connection con proveedor «erp»), con la forma de
 * las de Drive y Google Cloud (ConversationConnection): estado, «Gestionar» y, desplegado, el
 * mismo control de conexión que el menú de Finanzas. Solo presenta: conectar lo decide la persona.
 */
export function ErpConversationConnection() {
  const status = useMastererp(state => state.status);
  const check = useMastererp(state => state.check);
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (status === 'idle') void check();
  }, [status, check]);
  const connected = status === 'connected';
  const label = status === 'checking' || status === 'idle' ? 'Comprobando conexión' : connected ? 'Conectado' : status === 'error' ? 'No se pudo comprobar' : 'Sin conectar';
  const toggle = () => {
    setExpanded(value => !value);
    requestAnimationFrame(() => (expanded ? trigger.current : panel.current)?.focus());
  };
  return (
    <section className="conversation-connection-card" aria-label="Conexión con ERP · Finanzas en esta conversación">
      <header className="conversation-connection-header">
        <span className="nxs-logo nxs-logo-erp" aria-hidden="true"><FinanceIcon name="summary" /></span>
        <div><h3>ERP · Finanzas</h3><span className="conversation-connection-state" role="status">{label}</span></div>
        {expanded ? (
          <button type="button" ref={trigger} className="conversation-connection-close" aria-label="Cerrar configuración de ERP · Finanzas" aria-expanded={expanded} aria-controls={id} onClick={toggle}>
            <Icon name="x" />
          </button>
        ) : null}
      </header>
      {!expanded ? (
        <>
          <p>{connected ? 'Tu cuenta del ERP está conectada. Gestiona el acceso sin salir de esta conversación.' : 'Conecta tu cuenta de MasterERP para que Uony consulte tus datos de Finanzas.'}</p>
          <button type="button" ref={trigger} className="conversation-connection-manage" aria-controls={id} aria-expanded={false} onClick={toggle}>Gestionar ERP · Finanzas</button>
        </>
      ) : (
        <div
          id={id}
          ref={panel}
          className="conversation-connection-panel"
          tabIndex={-1}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.stopPropagation(); toggle(); }
          }}
        >
          <ErpConnectionCard />
        </div>
      )}
    </section>
  );
}
