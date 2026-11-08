import { CONVERSATION_STARTERS } from '../model/conversationStarters';
import { focusComposer } from './actions';
import { useComposerStore } from './composerStore';

export function selectConversationStarter(prompt: string) {
  const composer = useComposerStore.getState();
  const draft = composer.draft;
  // Sustituir solo una sugerencia intacta; conservar los detalles que haya añadido el cliente.
  const untouched = CONVERSATION_STARTERS.some(item => item.prompt === draft.trim());
  const next = !draft.trim() || untouched ? prompt : draft.includes(prompt) ? draft : `${draft.trimEnd()}\n\n${prompt}`;
  if (next.length > 3000) composer.setStatus('Tu mensaje ya tiene muchos detalles. Envíalo o acórtalo antes de añadir esta idea.');
  else { composer.setDraft(next); composer.setStatus(''); }
  focusComposer();
}
