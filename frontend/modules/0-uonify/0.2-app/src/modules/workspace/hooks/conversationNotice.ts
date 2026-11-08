import type { ChatMessage } from '../model/workspaceState';
import { useComposerStore } from './composerStore';
import { announce } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

/** Capa 2 del servidor, por si un recibo llega sin su texto. */
export const CHAT_RETRY_LATER = 'No he podido terminar esto ahora mismo. ¿Lo intento de nuevo?';

function replaceAt(threadId: string, index: number, message: ChatMessage): void {
  useWorkspaceStore.setState(state => ({ threads: state.threads.map(thread => thread.id !== threadId ? thread
    : { ...thread, messages: thread.messages.map((item, position) => (position === index ? message : item)) }) }));
}

/** Índice de la respuesta de Uony a esa petición: real o aviso (requestStatus). */
export function assistantIndexFor(threadId: string, requestId: string): number {
  const thread = useWorkspaceStore.getState().threads.find(item => item.id === threadId);
  return thread ? thread.messages.findIndex(message => message.role === 'assistant' && message.requestId === requestId) : -1;
}

/**
 * Orden del dueño (21-10-2026): el espacio bajo el compositor no es para errores.
 * Cuando una petición termina sin respuesta o no se admite, Uony lo dice en la
 * conversación con el texto del servidor (capa 2), como hace el historial al
 * recargar; la causa técnica se queda en el servidor. El aviso más reciente de
 * una petición sustituye al anterior, pero nunca a una respuesta real, y el hilo
 * deja de mostrar estados pendientes de esa petición bajo el compositor.
 */
export function noticeInConversation(threadId: string | null | undefined, text: string,
  requestId?: string, requestStatus: NonNullable<ChatMessage['requestStatus']> = 'error'): boolean {
  if (!threadId || !text) return false;
  const store = useWorkspaceStore.getState();
  const thread = store.threads.find(item => item.id === threadId);
  if (!thread) return false;
  useComposerStore.getState().clearThreadStatus(threadId);
  const notice: ChatMessage = { role: 'assistant', text, model: 'uonify-guide', requestId, requestStatus };
  const index = requestId ? assistantIndexFor(threadId, requestId) : -1;
  if (index >= 0) {
    const current = thread.messages[index];
    if (!current.requestStatus || (current.text === text && current.requestStatus === requestStatus)) return true;
    replaceAt(threadId, index, { ...current, ...notice });
  } else {
    const last = thread.messages.at(-1);
    if (!requestId && last?.role === 'assistant' && !last.requestId && last.text === text) return true;
    store.pushMessage(threadId, notice);
  }
  if (store.activeThreadId === threadId) announce(`Uony: ${text}`);
  return true;
}

/** Una respuesta real ocupa el lugar del aviso de su misma petición. */
export function replaceNoticeWithReply(threadId: string, requestId: string, reply: ChatMessage): boolean {
  const index = assistantIndexFor(threadId, requestId);
  const thread = useWorkspaceStore.getState().threads.find(item => item.id === threadId);
  if (index < 0 || !thread?.messages[index].requestStatus) return false;
  replaceAt(threadId, index, reply);
  return true;
}
