import { create } from 'zustand';
import { noticeInConversation } from './conversationNotice';
import { currentAccountEmail } from '@/modules/auth';
import { api, ApiError, errorMessage } from '@/shared/api/client';
import { expectedAssignmentFocus } from '../api/assignmentFocusExpectation';
import { isDurableRequest, type DurableRequest } from '../api/durableRequests';
import { emitAssistantReply } from '../model/events';
import { useComposerStore } from './composerStore';
import { watchDurableRequest } from './durableRequestWatcher';
import { useGooglePreferences } from './googlePreferences';
import { announce, useUiStore } from './uiStore';
import { activeThreadOf, useWorkspaceStore } from './workspaceStore';
import { observeSemanticRecovery } from './semanticRecovery';

type PendingFollowup = { account: string; epoch: number; threadId: string; requestId: string };
const RECOVERING_FOLLOWUP = 'Estamos recuperando tu consulta de estado. El trabajo anterior continúa.';
export const useWrittenFollowups = create<{ pending: PendingFollowup[] }>(() => ({ pending: [] }));

export function canSendWrittenFollowup(): boolean {
  const store = useWorkspaceStore.getState();
  const pending = useUiStore.getState().pendingReply;
  const account = currentAccountEmail();
  return !!account && account === store.historyAccount && !!pending?.requestId
    && pending.threadId === store.activeThreadId && !pending.requirements
    && !useWrittenFollowups.getState().pending.some(item => item.account === account && item.epoch === store.historyEpoch);
}

/** Consulta concurrente sin sustituir el trabajo activo ni conceder permiso de ejecución. */
export function sendWrittenFollowup(text: string): boolean {
  if (!canSendWrittenFollowup()) return false;
  const store = useWorkspaceStore.getState();
  const thread = activeThreadOf(store);
  const target = useUiStore.getState().pendingReply?.requestId;
  const account = currentAccountEmail();
  if (!thread || !target || !account) return false;
  // Un segundo envío del mismo texto pendiente no inicia otra interpretación.
  const original = thread.messages.find(message => message.requestId === target && message.role === 'user');
  const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  if (original && normalized(original.text) === normalized(text)) return false;
  const selection = useGooglePreferences.getState();
  const focus = expectedAssignmentFocus(account, thread.id);
  if (selection.account !== account || !selection.data || selection.saving || focus.kind === 'unavailable') return false;
  const { model, effort } = selection.data.preferences;
  const epoch = store.historyEpoch;
  const requestId = crypto.randomUUID();
  const valid = () => currentAccountEmail() === account && useWorkspaceStore.getState().historyAccount === account
    && useWorkspaceStore.getState().historyEpoch === epoch;
  const clearRecovery = () => {
    const composer = useComposerStore.getState();
    if (valid() && composer.threadStatuses[thread.id] === RECOVERING_FOLLOWUP) composer.clearThreadStatus(thread.id);
  };
  const finish = () => useWrittenFollowups.setState(state => ({ pending: state.pending.filter(item => item.requestId !== requestId) }));
  const body = { requestId, threadId: thread.id, text, projectId: thread.projectId ?? null, model, effort,
    ...(focus.kind === 'ready' ? { expectedAssignmentFocus: {
      assignmentId: focus.value.assignmentId, version: focus.value.version } } : {}) };
  useWrittenFollowups.setState(state => ({ pending: [...state.pending, { account, epoch, threadId: thread.id, requestId }] }));
  store.pushMessage(thread.id, { role: 'user', text, requestId, model, effort });
  store.setConversationExpanded(true);
  useComposerStore.getState().setDraft('');
  const fail = (message: string) => {
    if (valid()) noticeInConversation(thread.id, message, requestId);
    finish();
  };
  const settled = (result: DurableRequest) => {
    if (!valid()) { finish(); return; }
    observeSemanticRecovery(account, epoch, result);
    if (result.status !== 'success' || !result.response?.reply) {
      fail(result.error?.message ?? 'No hemos podido consultar esa solicitud. El trabajo anterior conserva su estado.');
      return;
    }
    const current = useWorkspaceStore.getState();
    clearRecovery();
    if (current.threads.some(item => item.id === thread.id && !item.messages.some(message => message.requestId === requestId && message.role === 'assistant'))) {
      current.pushMessage(thread.id, { role: 'assistant', requestId, text: result.response.reply,
        model: result.response.model, effort: result.response.effort });
      if (current.activeThreadId === thread.id) {
        announce(`Uony: ${result.response.reply}`);
        emitAssistantReply(result.response.reply, { threadId: thread.id });
      }
    }
    finish();
    current.retryHistory?.();
  };
  const follow = () => watchDurableRequest({ account, epoch, requestId, threadId: thread.id, targetRequestId: target, valid, settled,
    missing: () => fail('No podemos confirmar esta consulta. Conservamos tu pregunta y no la enviaremos otra vez.'),
    readRecovered: clearRecovery,
    readError: () => { if (valid()) useComposerStore.getState().setThreadStatus(thread.id,
      RECOVERING_FOLLOWUP); } });
  void api.post<unknown>(`/uony/requests/${encodeURIComponent(target)}/followups`, body,
    { signal: AbortSignal.timeout(30_000) }).then(result => {
    if (!valid()) { finish(); return; }
    if (!isDurableRequest(result) || result.requestId !== requestId || result.threadId !== thread.id
      || result.targetRequestId !== target) { follow(); return; }
    if (result.status === 'queued' || result.status === 'running') follow();
    else settled(result);
  }).catch(error => {
    if (!valid()) { finish(); return; }
    // Si se perdió la respuesta solo se consulta el recibo; no se repite la inferencia.
    if (!(error instanceof ApiError) || error.status >= 500 || error.status === 408) { follow(); return; }
    const current = useWorkspaceStore.getState();
    useWorkspaceStore.setState(state => ({ threads: state.threads.map(item => item.id === thread.id
      ? { ...item, messages: item.messages.filter(message => message.requestId !== requestId) } : item) }));
    if (current.activeThreadId === thread.id && !useComposerStore.getState().draft) useComposerStore.getState().setDraft(text);
    fail(errorMessage(error));
  });
  return true;
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => useWrittenFollowups.setState({ pending: [] }));
