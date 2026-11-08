import type { SemanticFailureEvent } from '../api/liveSemanticFailure';
import { currentAccountEmail } from '@/modules/auth';
import { settleLiveInterpretation } from './liveWorkProgress';
import { setUi, useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

type Scope = { account: string; epoch: number; threadId: string };
const rank = { pending: 0, unknown: 1, saved: 2 };

/** Deduplica la entrega del fallo sin crear mensajes ni otra ejecución. */
export function createLiveSemanticFailure(scope: Scope,
  show: (event: SemanticFailureEvent) => void): (event: SemanticFailureEvent) => boolean {
  const seen = new Map<string, SemanticFailureEvent>();
  return event => {
    const workspace = useWorkspaceStore.getState();
    if (currentAccountEmail() !== scope.account || workspace.historyAccount !== scope.account
      || workspace.historyEpoch !== scope.epoch || workspace.activeThreadId !== scope.threadId
      || event.threadId !== scope.threadId) return false;
    const previous = seen.get(event.requestId);
    if (previous && (previous.turnId !== event.turnId || previous.category !== event.category
      || previous.phase !== event.phase || previous.code !== event.code || previous.message !== event.message
      || previous.providerCode !== event.providerCode || rank[event.persistence] <= rank[previous.persistence])) return false;
    seen.set(event.requestId, event);
    if (seen.size > 256) seen.delete(seen.keys().next().value!);
    settleLiveInterpretation(scope, event.turnId);
    const pending = useUiStore.getState().pendingReply;
    if (event.execution === 'not_started' && pending?.threadId === scope.threadId
      && pending.requestId === event.requestId) setUi({ pendingReply: null });
    show(event);
    if (event.persistence === 'saved') workspace.retryHistory?.();
    return true;
  };
}
