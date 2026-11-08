import { useLayoutEffect, useRef, useState } from 'react';
import { ConversationActivationPanel, useConversationActivationOpen } from '@/modules/auth';
import { newConversation, setChatPanel } from '../hooks/actions';
import { setUi, useRegisterRef } from '../hooks/uiStore';
import { activeThreadOf, useWorkspaceStore } from '../hooks/workspaceStore';
import { ChatSash } from './ChatSash';
import { Composer } from './composer/Composer';
import { ConversationMessages } from './ConversationMessages';
import { ConversationActiveIndicator } from './ConversationActiveIndicator';
import { CloseIcon, PlusIcon } from './ShellIcons';

/**
 * Conversación con Uony (plantilla #view-espacio, `#conversation-dock`): cabecera
 * con el título del hilo, «Nueva conversación» y ocultar; mensajes a toda altura;
 * compositor abajo. Centrada sin servicio, a la derecha con uno (con su borde
 * redimensionable) o centrada dentro de la vista de un servicio.
 */
export interface ConversationPanelProps {
  hidden?: boolean;
  inert?: boolean;
  /** Panel a la derecha de un servicio: el borde lo redimensiona. */
  sidePanel?: boolean;
  /** Pintada por un servicio dentro de su vista (Producto sin ficha). */
  centredInService?: boolean;
  /** En el inicio el compositor está en la bienvenida, no aquí. */
  withComposer?: boolean;
}

export function ConversationPanel({ hidden = false, inert = false, sidePanel = false, centredInService = false, withComposer = true }: ConversationPanelProps) {
  const preparing = useConversationActivationOpen();
  const title = useWorkspaceStore(state => activeThreadOf(state)?.title ?? 'Nueva conversación');
  const dock = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [questionTarget, setQuestionTarget] = useState<HTMLDivElement | null>(null);
  useRegisterRef('dock', dock);
  useRegisterRef('conversationContent', content);
  return (
    <section
      ref={dock}
      className="conversation-dock"
      id="conversation-dock"
      aria-label="Conversación con Uony"
      hidden={hidden}
      inert={inert}
    >
      <ChatSash active={sidePanel} />
      <div className="conversation-header">
        <div className="conversation-title">
          <span className="assistant-symbol" aria-hidden="true">✳</span>
          <strong className="conversation-summary" id="conversation-summary">{title}</strong>
        </div>
        <div className="conversation-actions">
          <button className="conversation-action" id="conversation-new" type="button" aria-label="Nueva conversación" title="Nueva conversación" onClick={newConversation}>
            <PlusIcon />
          </button>
          <button className="conversation-action conversation-toggle" id="conversation-toggle" type="button" aria-controls="conversation-dock" aria-label="Ocultar conversación" title="Ocultar conversación" onClick={() => setChatPanel(false)}>
            <CloseIcon />
          </button>
        </div>
      </div>
      <div className="conversation-content" id="conversation-content" ref={content}>
        <ConversationMessages centredInService={centredInService} questionEnabled={withComposer && !hidden && !inert && !preparing}
          questionTarget={withComposer && !hidden && !inert && !preparing ? questionTarget : null} />
      </div>
      <div className="dock-composer-anchor" id="dock-composer-anchor">
        <div className="conversation-question-anchor" ref={setQuestionTarget} />
        {!hidden && !inert && withComposer && <ConversationActivationPanel />}
        {!hidden && !inert && withComposer && <ConversationActiveIndicator />}
        {withComposer ? <Composer /> : null}
      </div>
    </section>
  );
}

/**
 * Conversación que un servicio coloca dentro de su propia vista (Producto la
 * centra en su catálogo mientras no hay ficha). Mientras está montada, el espacio
 * no pinta su panel lateral y la columna queda en modo «chat centrado».
 */
export function ConversationDock() {
  useLayoutEffect(() => {
    setUi(state => ({ embeddedDocks: state.embeddedDocks + 1 }));
    return () => setUi(state => ({ embeddedDocks: Math.max(0, state.embeddedDocks - 1) }));
  }, []);
  return <ConversationPanel centredInService />;
}
