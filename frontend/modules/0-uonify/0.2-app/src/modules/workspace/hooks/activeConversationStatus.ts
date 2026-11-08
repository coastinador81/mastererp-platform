import { conversationFormOf } from '../model/conversationForm';
import type { Thread } from '../model/workspaceState';
import { DURABLE_POST_UNCERTAIN } from './durableDelivery';
import { DURABLE_READ_FORBIDDEN, DURABLE_READ_INTERRUPTED, DURABLE_READ_UNAUTHORIZED } from './durableRequestWatcher';
import type { PendingReply } from './uiStore';

export function isTransientConversationStatus(status: string): boolean {
  return [DURABLE_READ_INTERRUPTED, DURABLE_READ_UNAUTHORIZED, DURABLE_READ_FORBIDDEN, DURABLE_POST_UNCERTAIN].includes(status);
}

/** Comparte la decisión de visibilidad entre el indicador y el compositor. */
export function activeConversationStatusOf(thread: Thread | null, pending: PendingReply | null, status: string):
  { label: string; consumesComposerStatus: boolean } | null {
  if (!thread || !pending || pending.threadId !== thread.id) return null;
  if (pending.requirements) {
    const answeringForm = thread.messages.some(entry => {
      const form = conversationFormOf(entry.conversationForm, entry.role);
      return !!form && form.id === pending.requirements?.formId;
    });
    // La revisión de requisitos ya tiene su panel único en esta posición.
    if (!answeringForm) return null;
  }
  const transient = isTransientConversationStatus(status);
  return { label: transient ? status : pending.label, consumesComposerStatus: transient };
}
