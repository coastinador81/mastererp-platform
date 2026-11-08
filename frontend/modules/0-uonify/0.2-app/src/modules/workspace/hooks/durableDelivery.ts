import type { LiveWorkIntent } from '../api/liveTransport';
import { CHAT_RETRY_LATER, noticeInConversation, replaceNoticeWithReply } from './conversationNotice';
import { liveWorkLabel } from './liveWorkProgress';
import { currentAccountEmail } from '@/modules/auth';
import { notifyProductChanges } from '@/shared/pim';
import { connectionActionsOf } from '../model/connectionActions';
import { conversationFormOf } from '../model/conversationForm';
import { instructionMaterialAnalysisOf, materialAnalysisOf } from '../model/materialAnalysis';
import { productIntakeOf } from '../model/productIntake';
import { productProposalForThread } from '../model/productProposal';
import { emitAssistantReply } from '../model/events';
import type { DurableRequest, LiveReply } from '../api/durableRequests';
import { useWorkspaceStore } from './workspaceStore';
import { useComposerStore } from './composerStore';
import { announce, setUi, useUiStore } from './uiStore';
import { useConversationRecovery } from './conversationRecovery';
import { isDurableReadStatus } from './durableRequestWatcher';
import { forgetManualDurableRetry } from './manualDurableRetry';
import { rememberExpectedAssignmentFocus } from '../api/assignmentFocusExpectation';
import { observeSemanticRecovery } from './semanticRecovery';

export const DURABLE_POST_UNCERTAIN = 'Estamos comprobando si Uony recibió tu petición. No la enviaremos de nuevo.';

export function durableIdentity(account: string, epoch: number): boolean {
  return account === currentAccountEmail() && epoch === useWorkspaceStore.getState().historyEpoch;
}

export function ensureDurablePrompt(account: string, epoch: number, requestId: string, threadId: string,
  text: string, model: string, effort: string): void {
  if (!durableIdentity(account, epoch)) return;
  const store = useWorkspaceStore.getState();
  const existing = store.threads.find(thread => thread.id === threadId);
  if (!existing) {
    useWorkspaceStore.setState(state => ({ threads: [...state.threads, { id: threadId, title: text.slice(0, 36),
      projectId: null, service: null, view: 'default', messages: [{ role: 'user', text, model, effort, requestId }] }],
      activeThreadId: state.activeThreadId ?? threadId, conversationExpanded: true }));
  } else if (!existing.messages.some(message => message.requestId === requestId && message.role === 'user')) {
    store.pushMessage(threadId, { role: 'user', text, model, effort, requestId });
  }
}

export function showDurablePending(account: string, epoch: number, requestId: string, threadId: string,
  label = 'Uony está preparando tu respuesta…', purpose?: LiveWorkIntent): void {
  if (!durableIdentity(account, epoch)) return;
  const current = useUiStore.getState().pendingReply;
  if (!current || current.requestId === requestId) setUi({ pendingReply: {
    threadId, requestId, label, purpose,
  } });
}

/** El progreso es provisional y solo modifica la línea junto al compositor. */
export function showDurableProgress(account: string, epoch: number, result: DurableRequest): void {
  if (!durableIdentity(account, epoch)) return;
  const current = useUiStore.getState().pendingReply;
  if (!current || current.requestId !== result.requestId || current.threadId !== result.threadId) return;
  const labels: Record<string, string> = {
    queued: 'Uony está preparando tu respuesta…',
    preparing: 'Uony está preparando los datos…',
    consulting_google: 'Uony está preparando tu respuesta…',
    checking_result: 'Uony está ultimando su respuesta…',
  };
  const driveLabels: Record<string, string> = {
    queued: 'Uony está revisando tu Drive…',
    preparing: 'Uony está revisando tu Drive…',
    consulting_google: 'Uony está revisando tu Drive…',
    checking_result: 'Uony está ultimando la revisión de tu Drive…',
  };
  const label = current.purpose && current.purpose !== 'drive_access'
    ? liveWorkLabel(current.purpose, result.progress?.stage, result.status)
    : (current.purpose === 'drive_access' ? driveLabels : labels)[result.progress?.stage ?? ''] ?? current.label;
  if (label !== current.label) setUi({ pendingReply: { ...current, label } });
  // F1-S (lote 8, maqueta «A · Va apareciendo»): el texto que Uony está escribiendo, solo el de esta petición.
  const provisional = result.progress?.provisional;
  const shown = useUiStore.getState().provisionalReply;
  if (provisional?.text) {
    if (shown?.requestId !== result.requestId || shown.seq !== provisional.seq || shown.text !== provisional.text)
      setUi({ provisionalReply: { threadId: result.threadId, requestId: result.requestId, text: provisional.text, seq: provisional.seq } });
  } else clearProvisionalReply(result.requestId);
}

/** El texto a medias desaparece en cuanto llega la respuesta definitiva o el aviso de Uony. */
function clearProvisionalReply(requestId: string): void {
  if (useUiStore.getState().provisionalReply?.requestId === requestId) setUi({ provisionalReply: null });
}

export function applyDurableReply(account: string, epoch: number, requestId: string, threadId: string,
  result: LiveReply): void {
  if (!durableIdentity(account, epoch)) return;
  useComposerStore.getState().clearThreadStatus(threadId);
  clearProvisionalReply(requestId);
  const createdFocus = result.createdAssignmentFocus;
  let refreshCreatedAssignment = false;
  let focusUnverified = false;
  if (createdFocus) {
    if (rememberExpectedAssignmentFocus(account, threadId, createdFocus.assignmentId, createdFocus.version)) {
      refreshCreatedAssignment = true;
    } else focusUnverified = true;
  }
  const store = useWorkspaceStore.getState();
  const thread = store.threads.find(item => item.id === threadId);
  const reply = { role: 'assistant' as const, requestId, text: result.reply,
    model: result.model, effort: result.effort, productChanges: result.productChanges,
    connectionActions: connectionActionsOf(result.connectionActions, 'assistant'),
    conversationForm: conversationFormOf(result.conversationForm, 'assistant'),
    materialAnalysis: materialAnalysisOf(result.materialAnalysis, 'assistant'),
    productIntake: productIntakeOf(result.productIntake, 'assistant'),
    productProposal: productProposalForThread(result.productProposal, 'assistant', threadId),
    conversationFormFresh: store.activeThreadId === threadId };
  // Lote 6: la respuesta real sustituye el aviso de su misma petición (p. ej., un reintento manual).
  const replaced = !!thread && replaceNoticeWithReply(threadId, requestId, reply);
  if (thread && (replaced || !thread.messages.some(message => message.role === 'assistant' && message.requestId === requestId))) {
    if (!replaced) store.pushMessage(threadId, reply);
    if (result.productChanges?.length) notifyProductChanges(result.productChanges);
    if (store.activeThreadId === threadId) {
      announce(`Uony: ${result.reply}`);
      emitAssistantReply(result.reply, { threadId, requestId });
    }
  }
  if (focusUnverified) noticeInConversation(threadId,
    'El encargo está guardado, pero no podemos comprobar su selección en este navegador. Actualiza tus encargos antes de continuar.');
  const pending = useUiStore.getState().pendingReply;
  if (pending?.requestId === requestId && pending.threadId === threadId) {
    setUi({ pendingReply: null });
    const composer = useComposerStore.getState();
    if (composer.statusThreadId === threadId
      && (isDurableReadStatus(composer.status) || composer.status === DURABLE_POST_UNCERTAIN)) composer.setStatus('');
  }
  if (refreshCreatedAssignment) window.dispatchEvent(new CustomEvent('uonify:assignment-created',
    { detail: { account, threadId } }));
  if (instructionMaterialAnalysisOf(materialAnalysisOf(result.materialAnalysis, 'assistant'))?.assignmentId)
    window.dispatchEvent(new CustomEvent('uonify:assignment-work-changed',
      { detail: { account, threadId } }));
  useWorkspaceStore.getState().retryHistory?.();
}

export function settleDurableRequest(account: string, epoch: number, result: DurableRequest): void {
  if (!durableIdentity(account, epoch)) return;
  forgetManualDurableRetry(account, epoch, result.threadId, result.requestId);
  if (result.status === 'success' && result.response && typeof result.response.reply === 'string') {
    applyDurableReply(account, epoch, result.requestId, result.threadId, result.response);
    observeSemanticRecovery(account, epoch, result);
    return;
  }
  if (useUiStore.getState().pendingReply?.requestId === result.requestId) setUi({ pendingReply: null });
  clearProvisionalReply(result.requestId);
  const composer = useComposerStore.getState();
  // Orden del dueño (lote 6): ningún error bajo el compositor; Uony lo dice en la conversación,
  // salvo que lo diga ya la tarjeta de conexión de este hilo (sin repetir el texto).
  composer.clearThreadStatus(result.threadId);
  if (!connectionActionsOf(result.connectionActions, 'assistant')?.length) {
    noticeInConversation(result.threadId, result.error?.message || CHAT_RETRY_LATER, result.requestId,
      result.status === 'unknown' || result.status === 'cancelled' ? result.status : 'error');
  }
  if (composer.statusThreadId === result.threadId
    && (isDurableReadStatus(composer.status) || composer.status === DURABLE_POST_UNCERTAIN)) composer.setStatus('');
  const actions = connectionActionsOf(result.connectionActions, 'assistant');
  if (actions?.length) useConversationRecovery.setState({ recovery: { account, threadId: result.threadId,
    message: result.error?.message || 'Revisa la conexión para continuar.', actions } });
  useWorkspaceStore.getState().retryHistory?.();
  observeSemanticRecovery(account, epoch, result);
}
