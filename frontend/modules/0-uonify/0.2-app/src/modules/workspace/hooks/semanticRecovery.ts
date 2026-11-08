import { currentAccountEmail } from '@/modules/auth';
import { noticeInConversation } from './conversationNotice';
import type { SemanticRecovery } from '../api/semanticRecovery';
import type { DurableRequest } from '../api/durableRequests';
import { durableReadStatus, isDurableReadStatus, watchDurableRequest } from './durableRequestWatcher';
import { liveWorkLabel, observeLiveProgressWork, settleLiveInterpretation, updateLiveWork } from './liveWorkProgress';
import { useComposerStore } from './composerStore';
import { setUi, useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

type Receipt = { threadId: string; requestId: string; semanticRecovery?: SemanticRecovery };
const observed = new Set<string>();

/** Sigue recibos y negocio por GET, sin ejecutar ni volver a entregar su respuesta. */
export function observeSemanticRecovery(account: string, epoch: number, receipt: Receipt): void {
  const recovery = receipt.semanticRecovery;
  const observingCommand = recovery?.disposition === 'observing' && !recovery.businessRequestId
    && !!recovery.observedRequestId;
  const requestId = observingCommand ? recovery?.observedRequestId : recovery?.businessRequestId;
  const valid = () => currentAccountEmail() === account && useWorkspaceStore.getState().historyAccount === account
    && useWorkspaceStore.getState().historyEpoch === epoch
    && useWorkspaceStore.getState().threads.some(thread => thread.id === receipt.threadId);
  if (!valid() || !recovery || !requestId || requestId === receipt.requestId
    || !observingCommand && !['queued', 'running'].includes(recovery.businessStatus ?? '')) return;
  const key = JSON.stringify([account, epoch, receipt.requestId, requestId]);
  if (observed.has(key)) return;
  observed.add(key);
  if (observed.size > 256) observed.delete(observed.values().next().value!);
  const scope = { account, epoch, threadId: receipt.threadId };
  const showPending = (status: string, stage?: string, commandPending = false) => {
    const pending = useUiStore.getState().pendingReply;
    const previousPurpose = pending?.requestId === requestId ? pending.purpose : undefined;
    const purpose = commandPending ? 'recover_request'
      : observingCommand && previousPurpose === 'recover_request' ? undefined : previousPurpose;
    if (!pending || pending.threadId === receipt.threadId
      && (pending.requestId === requestId || pending.requestId === receipt.requestId))
      setUi({ pendingReply: { threadId: receipt.threadId, requestId,
        label: liveWorkLabel(purpose, stage, status), ...(purpose ? { purpose } : {}) } });
  };
  const refresh = () => useWorkspaceStore.getState().retryHistory?.();
  const commandPending = (result: DurableRequest) => observingCommand
    && result.semanticRecovery?.businessRequestId !== requestId;
  const update = (result: DurableRequest) => {
    if (commandPending(result)) {
      if (result.sourceLiveTurnId && !['queued', 'running'].includes(result.status))
        settleLiveInterpretation(scope, result.sourceLiveTurnId);
    } else if (result.sourceLiveTurnId) observeLiveProgressWork(scope, { type: 'handoff', threadId: receipt.threadId,
      turnId: result.sourceLiveTurnId, requestId, status: result.status });
    updateLiveWork(scope, requestId, result.status, result.progress?.stage);
  };
  showPending(recovery.businessStatus ?? 'running', undefined, observingCommand);
  watchDurableRequest({ account, epoch, requestId, threadId: receipt.threadId, valid,
    progressed: result => {
      if (!valid()) return;
      update(result);
      showPending(result.status, result.progress?.stage, commandPending(result));
      observeSemanticRecovery(account, epoch, result);
    },
    settled: result => {
      if (!valid()) return;
      update(result);
      const pending = useUiStore.getState().pendingReply;
      if (pending?.threadId === receipt.threadId && pending.requestId === requestId) setUi({ pendingReply: null });
      // Lote 6 (dueño): sin errores bajo el compositor; Uony lo dice en la conversación.
      if (result.status !== 'success') noticeInConversation(receipt.threadId,
        result.error?.message || 'No hemos podido completar la solicitud recuperada. Su estado se conserva.', requestId,
        result.status === 'unknown' || result.status === 'cancelled' ? result.status : 'error');
      refresh();
      observeSemanticRecovery(account, epoch, result);
    },
    readError: error => { if (valid()) useComposerStore.getState().setThreadStatus(receipt.threadId, durableReadStatus(error)); },
    readRecovered: () => {
      const composer = useComposerStore.getState();
      if (valid() && isDurableReadStatus(composer.threadStatuses[receipt.threadId] ?? '')) composer.clearThreadStatus(receipt.threadId);
    },
    missing: () => {
      if (!valid()) return;
      updateLiveWork(scope, requestId, 'unknown');
      const pending = useUiStore.getState().pendingReply;
      if (pending?.threadId === receipt.threadId && pending.requestId === requestId) setUi({ pendingReply: null });
      noticeInConversation(receipt.threadId,
        'No podemos confirmar el estado de la solicitud recuperada. No la enviaremos otra vez.', requestId, 'unknown');
      refresh();
    },
  });
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => observed.clear());
