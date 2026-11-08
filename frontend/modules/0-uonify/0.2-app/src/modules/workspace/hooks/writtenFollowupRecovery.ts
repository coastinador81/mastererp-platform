import type { DurableRequest, DurableRequestSummary } from '../api/durableRequests';
import { noticeInConversation } from './conversationNotice';
import { emitAssistantReply } from '../model/events';
import { useComposerStore } from './composerStore';
import { durableIdentity, ensureDurablePrompt } from './durableDelivery';
import { watchDurableRequest } from './durableRequestWatcher';
import { announce } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';
import { useWrittenFollowups } from './writtenFollowup';
import { observeSemanticRecovery } from './semanticRecovery';

const RECOVERING = 'Estamos recuperando tu consulta de estado. El trabajo original conserva su estado.';
const valid = (account: string, epoch: number) => durableIdentity(account, epoch)
  && useWorkspaceStore.getState().historyAccount === account;
const forget = (account: string, epoch: number, requestId: string) => useWrittenFollowups.setState(state => ({
  pending: state.pending.filter(item => item.account !== account || item.epoch !== epoch || item.requestId !== requestId),
}));
const clearRecovery = (threadId: string) => {
  const composer = useComposerStore.getState();
  if (composer.threadStatuses[threadId] === RECOVERING) composer.clearThreadStatus(threadId);
};

/** Entrega únicamente el texto de B: no aplica cambios de producto ni toca pendingReply A. */
export function settleRecoveredWrittenFollowup(account: string, epoch: number, result: DurableRequest): void {
  if (!result.targetRequestId || !valid(account, epoch)) return;
  observeSemanticRecovery(account, epoch, result);
  const store = useWorkspaceStore.getState();
  if (result.status === 'success' && typeof result.response?.reply === 'string') {
    clearRecovery(result.threadId);
    const thread = store.threads.find(item => item.id === result.threadId);
    if (thread && !thread.messages.some(item => item.role === 'assistant' && item.requestId === result.requestId)) {
      store.pushMessage(result.threadId, { role: 'assistant', requestId: result.requestId,
        text: result.response.reply, model: result.response.model, effort: result.response.effort });
      if (store.activeThreadId === result.threadId) {
        announce(`Uony: ${result.response.reply}`);
        emitAssistantReply(result.response.reply, { threadId: result.threadId });
      }
    }
  } else {
    noticeInConversation(result.threadId,
      result.error?.message ?? 'No hemos podido confirmar esta consulta. El trabajo original conserva su estado.', result.requestId,
      result.status === 'unknown' || result.status === 'cancelled' ? result.status : 'error');
  }
  forget(account, epoch, result.requestId);
  store.retryHistory?.();
}

/** Tras recargar, observa B con el mismo UUID y destino; nunca reenvía su POST. */
export function recoverWrittenFollowup(account: string, epoch: number, request: DurableRequestSummary): void {
  if (!request.targetRequestId || !valid(account, epoch)) return;
  ensureDurablePrompt(account, epoch, request.requestId, request.threadId, request.text, request.model, request.effort);
  if (request.status !== 'queued' && request.status !== 'running') {
    settleRecoveredWrittenFollowup(account, epoch, request);
    return;
  }
  useWrittenFollowups.setState(state => ({ pending: state.pending.some(item => item.account === account
    && item.epoch === epoch && item.requestId === request.requestId) ? state.pending
    : [...state.pending, { account, epoch, threadId: request.threadId, requestId: request.requestId }] }));
  watchDurableRequest({ account, epoch, requestId: request.requestId, threadId: request.threadId,
    targetRequestId: request.targetRequestId, valid: () => valid(account, epoch),
    settled: result => settleRecoveredWrittenFollowup(account, epoch, result),
    readError: () => {
      if (valid(account, epoch)) useComposerStore.getState().setThreadStatus(request.threadId, RECOVERING);
    },
    readRecovered: () => { if (valid(account, epoch)) clearRecovery(request.threadId); },
    missing: () => {
      if (!valid(account, epoch)) return;
      noticeInConversation(request.threadId,
        'No podemos confirmar esta consulta. Conservamos tu pregunta y no la enviaremos otra vez.', request.requestId);
      forget(account, epoch, request.requestId);
      useWorkspaceStore.getState().retryHistory?.();
    } });
}
