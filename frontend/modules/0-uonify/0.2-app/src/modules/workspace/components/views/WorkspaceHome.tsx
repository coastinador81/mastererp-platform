import { useComposerStore } from '../../hooks/composerStore';
import { ConversationActivationPanel } from '@/modules/auth';
import { selectConversationStarter } from '../../hooks/starterActions';
import { CONVERSATION_STARTERS } from '../../model/conversationStarters';
import { activeThreadOf, useWorkspaceStore } from '../../hooks/workspaceStore';
import { Composer } from '../composer/Composer';
import { ConversationRecovery } from '../ConversationRecovery';

/**
 * Lienzo en blanco del espacio (app-shell.js, `renderHome`): «Hazlo posible.»,
 * el compositor y las ideas para empezar (se pueden quitar). Con un hilo abierto y
 * sin servicio, la conversación ocupa la columna (la pinta el layout) y aquí no
 * hay nada.
 */
function PromptSuggestions() {
  const dismissed = useComposerStore(state => state.dismissedSuggestions);
  return (
    <div className="prompt-suggestions" aria-label="Ideas para empezar">
      {CONVERSATION_STARTERS.map(item => (
        <div key={item.id} className="prompt-suggestion" data-suggestion-id={item.id} hidden={dismissed.includes(item.id)}>
          <button type="button" data-prompt-suggestion={item.prompt} onClick={() => selectConversationStarter(item.prompt)}>
            {item.label}
          </button>
          <button type="button" data-suggestion-dismiss="" aria-label={`Quitar sugerencia: ${item.label}`} onClick={() => useComposerStore.getState().dismissSuggestion(item.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function WorkspaceHome() {
  const hasThread = useWorkspaceStore(state => activeThreadOf(state) !== null);
  if (hasThread) return null;
  return (
    <div className="welcome">
      <h1>
        Hazlo <em>posible.</em>
      </h1>
      <div className="welcome-composer-anchor" id="welcome-composer-anchor">
        <ConversationActivationPanel />
        <Composer />
      </div>
      <ConversationRecovery />
      <PromptSuggestions />
    </div>
  );
}
