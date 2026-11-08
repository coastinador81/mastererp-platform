import { useId, useRef, useState } from 'react';
import { Icon } from '@/shared/ui';
import { useAmazonConnection } from '../hooks/useAmazonConnection';
import { AmazonConnectionSettings } from './AmazonConnectionSettings';
import '../styles/amazon-conversation.css';

interface Props { account: string }

export function AmazonConversationConnection(props: Props) {
  // Cambiar de identidad descarta permisos, mensajes y ventanas de la anterior.
  return <AccountConversationConnection key={props.account} {...props} />;
}

function AccountConversationConnection({ account }: Props) {
  const state = useAmazonConnection(account);
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const connected = !state.isError && state.data?.connection.status === 'connected';
  const label = state.isPending ? 'Comprobando conexión' : state.isError ? 'No se pudo comprobar' : connected ? 'Conectado' : 'Sin conectar';
  const toggle = () => {
    if (busy) return;
    if (expanded) {
      setExpanded(false);
      requestAnimationFrame(() => toggleRef.current?.focus());
    } else {
      setOpened(true);
      setExpanded(true);
      requestAnimationFrame(() => panelRef.current?.focus());
    }
  };
  return <section className="amz-conversation-card" aria-label="Conexión con Amazon en esta conversación">
    <header className="amz-conversation-header">
      <span className="amz-conversation-logo"><img src="/assets/brands/amazon-logo.svg" alt="" width="40" height="40" /></span>
      <div className="amz-conversation-title"><h3>Amazon Seller Central</h3><span className={`amz-conversation-state${connected ? ' is-connected' : ''}`} role="status">{label}</span></div>
      {expanded && <button ref={toggleRef} className="amz-conversation-close" aria-label="Cerrar configuración de Amazon" aria-expanded={expanded} aria-controls={id} disabled={busy} onClick={toggle}><Icon name="x" /></button>}
    </header>
    {!expanded && <>
      <p>{connected ? 'Tu cuenta de vendedor está conectada. Puedes gestionarla sin salir de este chat.' : 'Conecta tu cuenta de vendedor para preparar tus fichas. La conversación permanece aquí.'}</p>
      <button ref={toggleRef} className="amz-conversation-primary" aria-expanded={expanded} aria-controls={id} onClick={toggle}>{connected ? 'Gestionar conexión' : 'Conectar Amazon'}</button>
    </>}
    {opened && <div id={id} ref={panelRef} className="amz-conversation-panel" tabIndex={-1} hidden={!expanded} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); toggle(); }
    }}>
      <AmazonConnectionSettings account={account} placement="conversation" onBusyChange={setBusy} />
    </div>}
  </section>;
}
