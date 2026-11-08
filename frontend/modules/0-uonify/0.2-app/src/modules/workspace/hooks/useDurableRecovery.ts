import { useEffect } from 'react';
import { noticeInConversation } from './conversationNotice';
import { currentAccountEmail } from '@/modules/auth';
import { ApiError } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { getRecentDurableRequests, getUnresolvedDurableRequests, type DurableRequest } from '../api/durableRequests';
import { useComposerStore } from './composerStore';
import { durableIdentity, ensureDurablePrompt, settleDurableRequest, showDurablePending, showDurableProgress } from './durableDelivery';
import { durableReadStatus, isDurableReadStatus, watchDurableRequest } from './durableRequestWatcher';
import { setUi, useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';
import { useWrittenFollowups } from './writtenFollowup';
import { recoverWrittenFollowup, settleRecoveredWrittenFollowup } from './writtenFollowupRecovery';
import { observeSemanticRecovery } from './semanticRecovery';

let gate: { account: string; epoch: number; ready: boolean } | null = null;
const RECOVERY_READ_INTERRUPTED = 'Estamos recuperando el estado de tu petición. Espera a que vuelva la conexión.';
export function durableRecoveryReady(account: string, epoch: number): boolean {
  return !gate || gate.account !== account || gate.epoch !== epoch || gate.ready;
}

function settleRecovered(account: string, epoch: number, result: DurableRequest,
  sourceLiveTurnId = result.sourceLiveTurnId): void {
  if (result.targetRequestId) { settleRecoveredWrittenFollowup(account, epoch, result); return; }
  if (!sourceLiveTurnId) { settleDurableRequest(account, epoch, result); return; }
  if (!durableIdentity(account, epoch)) return;
  if (useUiStore.getState().pendingReply?.requestId === result.requestId) setUi({ pendingReply: null });
  const composer = useComposerStore.getState();
  if (isDurableReadStatus(composer.threadStatuses[result.threadId] ?? '')) composer.clearThreadStatus(result.threadId);
  observeSemanticRecovery(account, epoch, result);
  useWorkspaceStore.getState().retryHistory?.();
}

/** Reabre trabajo del servidor mediante GET; nunca repite el POST a Gemini. */
export function useDurableRecovery(): void {
  const owner = useWorkspaceStore(state => state.historyAccount);
  const epoch = useWorkspaceStore(state => state.historyEpoch);
  const account = owner;
  useEffect(() => {
    if (USE_MOCKS || !account || owner !== account || currentAccountEmail() !== account) return;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    gate = { account, epoch, ready: false };
    const valid = () => !controller.signal.aborted && durableIdentity(account, epoch);
    const recover = async () => {
      try {
        const allRecent = await getRecentDurableRequests(controller.signal);
        if (!valid()) return;
        if (useComposerStore.getState().status === RECOVERY_READ_INTERRUPTED) {
          useComposerStore.getState().setStatus('');
        }
        gate = { account, epoch, ready: true };
        // B es una lectura de A: nunca ocupa su indicador ni se convierte en otro trabajo.
        const recent = allRecent.filter(item => !item.targetRequestId);
        const followups = allRecent.filter(item => item.targetRequestId);
        const currentPending = useUiStore.getState().pendingReply?.requestId;
        if (followups.some(item => item.requestId === currentPending)) setUi({ pendingReply: null });
        for (const request of allRecent) observeSemanticRecovery(account, epoch, request);
        for (const followup of followups) {
          const pending = followup.status === 'queued' || followup.status === 'running';
          const known = useWrittenFollowups.getState().pending.some(item => item.account === account
            && item.epoch === epoch && item.requestId === followup.requestId);
          const latestInThread = !allRecent.some(item => item.threadId === followup.threadId
            && item.createdAt > followup.createdAt);
          if (pending || known || (latestInThread && ['error', 'unknown', 'cancelled'].includes(followup.status))) {
            recoverWrittenFollowup(account, epoch, followup);
          }
        }
        const pendingRequestId = useUiStore.getState().pendingReply?.requestId;
        const settledPending = recent.find(item => item.requestId === pendingRequestId
          && item.status !== 'queued' && item.status !== 'running');
        if (settledPending) settleRecovered(account, epoch, settledPending);
        const active = recent.filter(item => item.status === 'queued' || item.status === 'running');
        const remaining = new Set(active.map(item => item.requestId));
        const showNextPending = () => {
          const next = active.find(item => remaining.has(item.requestId));
          if (next) {
            showDurablePending(account, epoch, next.requestId, next.threadId);
            showDurableProgress(account, epoch, next);
          }
        };
        if (active.length) {
          showNextPending();
          for (const request of active) {
            if (!request.sourceLiveTurnId) ensureDurablePrompt(account, epoch, request.requestId,
              request.threadId, request.text, request.model, request.effort);
            watchDurableRequest({ account, epoch, requestId: request.requestId, threadId: request.threadId,
              targetRequestId: null,
              valid: () => durableIdentity(account, epoch),
              settled: result => {
                settleRecovered(account, epoch, result, request.sourceLiveTurnId);
                remaining.delete(request.requestId);
                if (valid()) showNextPending();
              },
              progressed: result => showDurableProgress(account, epoch, result),
              readError: error => {
                if (durableIdentity(account, epoch) && useUiStore.getState().pendingReply?.requestId === request.requestId) {
                  const composer = useComposerStore.getState();
                  composer.setThreadStatus(request.threadId, durableReadStatus(error));
                  if (!composer.status || (composer.statusThreadId === request.threadId && isDurableReadStatus(composer.status))) {
                    composer.setStatus(durableReadStatus(error), request.threadId);
                  }
                }
              },
              readRecovered: () => {
                const composer = useComposerStore.getState();
                if (isDurableReadStatus(composer.threadStatuses[request.threadId] ?? '')) composer.clearThreadStatus(request.threadId);
                if (durableIdentity(account, epoch) && useUiStore.getState().pendingReply?.requestId === request.requestId
                  && composer.statusThreadId === request.threadId && isDurableReadStatus(composer.status)) {
                  composer.setStatus('');
                }
              },
              missing: () => {
                if (!durableIdentity(account, epoch)) return;
                if (useUiStore.getState().pendingReply?.requestId === request.requestId) setUi({ pendingReply: null });
                if (!request.sourceLiveTurnId && useWorkspaceStore.getState().activeThreadId === request.threadId
                  && !useComposerStore.getState().draft) {
                  useComposerStore.getState().setDraft(request.text);
                }
                const composer = useComposerStore.getState();
                noticeInConversation(request.threadId, 'La petición dejó de estar disponible. Conservamos tu texto y no la repetiremos automáticamente.', request.requestId);
                if (composer.statusThreadId === request.threadId && isDurableReadStatus(composer.status)) composer.setStatus('');
                useWorkspaceStore.getState().retryHistory?.();
                remaining.delete(request.requestId);
                showNextPending();
              } });
          }
        }
        if (allRecent.some(item => item.status === 'success')) {
          // El historial puede haberse leído justo antes de finalizar el ejecutor.
          useWorkspaceStore.getState().retryHistory?.();
        } else if (!active.length && recent[0] && recent[0].requestId !== settledPending?.requestId
          && ['error', 'unknown', 'cancelled'].includes(recent[0].status)) {
          settleRecovered(account, epoch, recent[0]);
        }
        // Un consumo incierto no caduca con la ventana de "recientes". Se pagina
        // el índice completo y se reconcilia por UUID sin iniciar otra generación.
        void (async () => {
          try {
            const unresolved = await getUnresolvedDurableRequests(controller.signal);
            if (!valid()) return;
            const seen = new Set(allRecent.map(item => item.requestId));
            const older = unresolved.filter(item => !seen.has(item.requestId));
            if (older.length) useWorkspaceStore.getState().retryHistory?.();
            if (!active.length && older[0] && (!recent[0] || older[0].createdAt > recent[0].createdAt)) {
              settleRecovered(account, epoch, older[0]);
            }
          } catch (error) {
            // La API anterior puede carecer de esta lectura; la lista principal
            // sigue operativa y el servidor impide repetir un consumo incierto.
            if (error instanceof ApiError && error.status === 404) return;
          }
        })();
      } catch (error) {
        if (!valid()) return;
        if (error instanceof ApiError && error.status === 404) {
          // Durante la actualización local, la API anterior todavía responde al chat síncrono.
          gate = { account, epoch, ready: true };
          return;
        }
        const composer = useComposerStore.getState();
        if (!composer.status || composer.status === RECOVERY_READ_INTERRUPTED) composer.setStatus(RECOVERY_READ_INTERRUPTED);
        retryTimer = setTimeout(() => { void recover(); }, 5000);
      }
    };
    void recover();
    return () => { controller.abort(); clearTimeout(retryTimer); };
  }, [account, owner, epoch]);
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => { gate = null; });
