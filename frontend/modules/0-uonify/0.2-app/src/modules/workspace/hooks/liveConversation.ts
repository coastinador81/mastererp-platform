import { activeProductContext, hasProductEdits, notifyProductChanges } from '@/shared/pim';
import { noticeInConversation } from './conversationNotice';
import { focusComposer, openWorkspacePage, setChatPanel } from './actions';
import { api, ApiError, errorMessage } from '@/shared/api/client';
import { currentAccountEmail } from '@/modules/auth';
import type { FirstIntentDelivery } from '@/modules/auth';
import { activeThreadOf, useWorkspaceStore } from './workspaceStore';
import { useComposerStore } from './composerStore';
import { announce, setUi, useUiStore } from './uiStore';
import { emitAssistantReply } from '../model/events';
import { useGooglePreferences } from './googlePreferences';
import { connectionActionsOf } from '../model/connectionActions';
import { conversationFormOf } from '../model/conversationForm';
import { instructionMaterialAnalysisOf, materialAnalysisOf } from '../model/materialAnalysis';
import { productIntakeOf } from '../model/productIntake';
import { productProposalForThread } from '../model/productProposal';
import { productLinkVersion } from '../api/productMemory';
import { isDurablePending, isDurableRequest, type DurableRequest, type LiveReply } from '../api/durableRequests';
import type { ProductLinkDraft } from './composerStore';
import { durableRecoveryReady } from './useDurableRecovery';
import { DURABLE_POST_UNCERTAIN, settleDurableRequest, showDurableProgress } from './durableDelivery';
import { DURABLE_READ_INTERRUPTED, durableReadStatus, isDurableReadStatus, watchDurableRequest } from './durableRequestWatcher';
import { useConversationRecovery, type Recovery } from './conversationRecovery';
import { consumeThreadDraft, forgetManualDurableRetry, MANUAL_RETRY_STATUS, manualDurableRetryOf,
  rememberManualDurableRetry, rememberScopedDraft, rememberThreadDraft } from './manualDurableRetry';
import { expectedAssignmentFocus } from '../api/assignmentFocusExpectation';
import { sendWrittenFollowup, useWrittenFollowups } from './writtenFollowup';
export { useConversationRecovery } from './conversationRecovery';

import { HISTORY_WAIT } from './liveHistory';
export { useLiveHistory } from './liveHistory';
class UncertainDeliveryError extends Error {}
function connectionRecovery(error: unknown): Pick<Recovery, 'message' | 'actions'> | null {
  if (!(error instanceof ApiError) || ![409, 503].includes(error.status)) return null;
  const data = error.data as { error?: unknown; message?: unknown; connectionActions?: unknown } | null;
  if (!data || !['google_required', 'reauthorize', 'amazon_disconnected', 'amazon_reconnect'].includes(String(data.error))) return null;
  const actions = connectionActionsOf(data.connectionActions, 'assistant');
  return actions?.length ? { actions, message: errorMessage(error) } : null;
}
function uncertainDelivery(error: unknown): boolean {
  if (error instanceof UncertainDeliveryError || error instanceof TypeError) return true;
  if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) return true;
  if (error instanceof ApiError && error.status >= 500) {
    const data = error.data as { error?: unknown } | null;
    return !data || typeof data.error !== 'string';
  }
  return false;
}

interface LivePromptOptions {
  initialIntent?: FirstIntentDelivery;
  requestId?: string;
  expectedThreadId?: string;
  expectedProjectId?: string | null;
  preserveDraft?: boolean;
  formResponse?: { formId: string; answers: Record<string, string> };
  incidentAction?: { incidentId: string; action: 'start' | 'check' };
  materialAction?: { action: 'review'; sku: string; analysisId: string };
  requirementsAction?: { action: 'prepare'; sku: string; retry?: boolean; acknowledgeUnknown?: boolean;
    expectedRevision?: number; expectedLinkVersion?: number;
    expectedReasoningId?: string; expectedReasoningStatus?: 'error' | 'unknown';
    expectedSourceFingerprint?: string };
  productLink?: ProductLinkDraft;
  onSettled?: (success: boolean, error?: string, outcome?: 'conflict' | 'definitive' | 'uncertain' | 'failed') => void;
}

export function sendLivePrompt(text: string, options: LivePromptOptions = {}): boolean {
  const account = currentAccountEmail();
  const epoch = useWorkspaceStore.getState().historyEpoch;
  const sameIdentity = () => account === currentAccountEmail() && epoch === useWorkspaceStore.getState().historyEpoch;
  if (!text.trim() || text.length > 3000) return false;
  const store = useWorkspaceStore.getState();
  if (options.expectedThreadId && store.activeThreadId !== options.expectedThreadId) return false;
  if (options.expectedThreadId && !store.threads.some(item => item.id === options.expectedThreadId
    && (options.expectedProjectId === undefined || (item.projectId ?? null) === options.expectedProjectId))) return false;
  if (!account || store.historyAccount !== account) {
    useComposerStore.getState().setStatus(HISTORY_WAIT);  // Una espera, nunca un error (lote 6).
    if (account && !store.historyLoading) store.retryHistory?.();
    return false;
  }
  if (!durableRecoveryReady(account, epoch)) {
    useComposerStore.getState().setStatus('Estamos recuperando el estado de tu petición anterior. Tu texto se conserva.');
    return false;
  }
  if (useWrittenFollowups.getState().pending.some(item => item.account === account && item.epoch === epoch)) return false;
  if (useUiStore.getState().pendingReply) return Object.keys(options).length === 0 && sendWrittenFollowup(text);
  const retry = !options.initialIntent && !options.productLink && !options.formResponse && !options.incidentAction
    && !options.materialAction && !options.requirementsAction
    ? manualDurableRetryOf(account, epoch, store.activeThreadId, text) : null;
  const expectedFocus = !retry && (options.initialIntent?.threadId ?? store.activeThreadId)
    ? expectedAssignmentFocus(account, (options.initialIntent?.threadId ?? store.activeThreadId)!)
    : { kind: 'none' as const };
  if (expectedFocus.kind === 'unavailable') {
    noticeInConversation(options.initialIntent?.threadId ?? store.activeThreadId,
      'No podemos comprobar el encargo seleccionado. Tu texto se conserva; vuelve a cargar la conversación.');
    return false;
  }
  if (hasProductEdits()) { useComposerStore.getState().setStatus('Guarda los cambios de la ficha antes de pedir una edición a Uony.'); return false; }
  const submittedForm = activeThreadOf(store)?.messages.at(-1)?.conversationForm;
  const guide = submittedForm?.id === options.formResponse?.formId ? submittedForm?.context : undefined;
  const selection=useGooglePreferences.getState();
  if(!retry && !guide && !options.incidentAction && !options.materialAction && !options.requirementsAction && !options.productLink && (selection.account!==account || !selection.data || selection.saving)){useComposerStore.getState().setStatus('Espera a que se guarde la selección de IA.');return false;}
  const {model,effort}=retry ? retry.body as { model: string; effort: string } : options.initialIntent ?? (guide || options.incidentAction || options.materialAction || options.requirementsAction || options.productLink ? { model: 'auto', effort: 'medium' } : selection.data!.preferences);
  const thread = options.initialIntent
    ? store.threads.find(item => item.id === options.initialIntent!.threadId) ?? store.createThread({ id: options.initialIntent.threadId, title: text, service: null, view: 'default' })
    : activeThreadOf(store) ?? store.createThread({ title: text, service: null, view: 'default' });
  const preservedDraft = useComposerStore.getState().draft;
  const preservedProductLink = useComposerStore.getState().productLink;
  const structured = !!(options.productLink || options.formResponse || options.incidentAction
    || options.materialAction || options.requirementsAction);
  consumeThreadDraft(account, epoch, thread.id, text);
  if (options.preserveDraft) rememberScopedDraft(account, epoch, thread.id, preservedDraft, preservedProductLink);
  const emptyThreadBeforeSend = thread.messages.length === 0;
  if (options.initialIntent) store.setActiveThread(thread.id);
  useConversationRecovery.setState({ recovery: null });
  useComposerStore.getState().clearThreadStatus(thread.id);
  const requestId = options.requestId ?? retry?.requestId ?? options.initialIntent?.requestId ?? options.productLink?.requestId ?? crypto.randomUUID();
  if (!thread.messages.some(message => message.role === 'user' && message.requestId === requestId)) {
    store.pushMessage(thread.id, { role:'user',text,model,effort,requestId });
  }
  store.setConversationExpanded(true);
  if (!options.preserveDraft) useComposerStore.getState().setDraft('');
  useComposerStore.getState().setStatus('');
  const requirementsForm = guide?.kind === 'product_guide' && guide.section === 'amazon_requirements';
  setUi({ pendingReply:{ threadId:thread.id,requestId,label: options.requirementsAction || options.materialAction
    ? 'Actualizando las preguntas de tu producto…' : 'Uony está preparando tu respuesta…',
    ...(options.requirementsAction || options.materialAction ? { requirements: {} }
      : requirementsForm && options.formResponse ? { requirements: { formId: options.formResponse.formId } } : {}) } });
  let expectedVersion = options.productLink?.expectedVersion;
  const possiblyDurable = !options.productLink && !options.formResponse && !options.incidentAction
    && !options.materialAction && !options.requirementsAction;
  let watching = false;
  let sentBody: Record<string, unknown> | null = null;
  const follow = (uncertainPost = false) => {
    watching = true;
    watchDurableRequest({ account, epoch, requestId, threadId: thread.id, valid: sameIdentity,
      settled: result => {
        settleDurableRequest(account, epoch, result);
        options.onSettled?.(result.status === 'success' && !!result.response?.reply, result.error?.message);
      },
      progressed: result => {
        const composer = useComposerStore.getState();
        if (composer.threadStatuses[thread.id] === DURABLE_POST_UNCERTAIN) composer.clearThreadStatus(thread.id);
        if (sameIdentity() && useUiStore.getState().pendingReply?.requestId === requestId
          && useUiStore.getState().pendingReply?.threadId === thread.id
          && composer.status === DURABLE_POST_UNCERTAIN
          && composer.statusThreadId === thread.id) composer.setStatus('');
        showDurableProgress(account, epoch, result);
      },
      readError: error => {
        if (sameIdentity() && useUiStore.getState().pendingReply?.requestId === requestId) {
          const composer = useComposerStore.getState();
          const message = durableReadStatus(error);
          composer.setThreadStatus(thread.id, message);
          if (!composer.status || (composer.statusThreadId === thread.id && (isDurableReadStatus(composer.status)
            || (message !== DURABLE_READ_INTERRUPTED && composer.status === DURABLE_POST_UNCERTAIN)))) composer.setStatus(message, thread.id);
        }
      },
      readRecovered: () => {
        const composer = useComposerStore.getState();
        if (isDurableReadStatus(composer.threadStatuses[thread.id] ?? '')) composer.clearThreadStatus(thread.id);
        if (sameIdentity() && useUiStore.getState().pendingReply?.requestId === requestId
          && composer.statusThreadId === thread.id && isDurableReadStatus(composer.status)) {
          composer.setStatus('');
        }
      },
      missing: () => {
        if (!sameIdentity()) return;
        const activeThread = useWorkspaceStore.getState().activeThreadId === thread.id;
        if (uncertainPost && activeThread) {
          useWorkspaceStore.getState().withdrawLastMessage(thread.id, true);
          if (!useComposerStore.getState().draft) useComposerStore.getState().setDraft(text);
        }
        if (!options.initialIntent && sentBody) rememberManualDurableRetry({ account, epoch, threadId: thread.id, text, requestId, body: sentBody });
        if (useUiStore.getState().pendingReply?.requestId === requestId) setUi({ pendingReply: null });
        if (activeThread && !useComposerStore.getState().draft) useComposerStore.getState().setDraft(text);
        const message = uncertainPost
          ? MANUAL_RETRY_STATUS
          : 'La petición dejó de estar disponible. Conservamos tu texto y no la repetiremos automáticamente.';
        const composer = useComposerStore.getState();
        noticeInConversation(thread.id, message, requestId);
        if (composer.statusThreadId === thread.id
          && (isDurableReadStatus(composer.status) || composer.status === DURABLE_POST_UNCERTAIN)) composer.setStatus('');
        options.onSettled?.(false, message);
      } });
  };
  const submit = async () => {
    if (options.productLink && expectedVersion === undefined) {
      expectedVersion = options.productLink.threadId && !emptyThreadBeforeSend
        ? await productLinkVersion(thread.id) : 0;
      if (!sameIdentity()) return null;
    }
    const body = retry?.body ?? {
      requestId,threadId:thread.id,text,model,effort,
      ...(options.initialIntent ? {} : {projectId:options.expectedProjectId === undefined
        ? thread.projectId ?? null : options.expectedProjectId}),
      ...(options.initialIntent ? {} : options.productLink
        ? {productAction:{action:'link',sku:options.productLink.sku,revision:options.productLink.revision,expectedVersion}}
        : options.requirementsAction ? {} : {productContext:activeProductContext()}),
      ...(options.formResponse ? { formResponse: options.formResponse } : {}),
      ...(options.incidentAction ? { incidentAction: options.incidentAction } : {}),
      ...(options.materialAction ? { materialAction: options.materialAction } : {}),
      ...(options.requirementsAction ? { requirementsAction: options.requirementsAction } : {}),
      ...(expectedFocus.kind === 'ready' ? { expectedAssignmentFocus: {
        assignmentId: expectedFocus.value.assignmentId, version: expectedFocus.value.version } } : {}),
    };
    sentBody = body;
    return api.post<LiveReply | DurableRequest>('/uony/messages', body,
      { signal:AbortSignal.timeout(195_000) });
  };
  void submit()
    .then(result => {
      if (!sameIdentity() || !result) return;
      if (isDurablePending(result)) {
        if (result.requestId !== requestId || result.threadId !== thread.id) throw new UncertainDeliveryError('La petición iniciada no coincide con este mensaje.');
        forgetManualDurableRetry(account, epoch, thread.id, requestId);
        follow();
        return;
      }
      if (isDurableRequest(result)) {
        if (result.requestId !== requestId || result.threadId !== thread.id) throw new UncertainDeliveryError('La petición iniciada no coincide con este mensaje.');
        forgetManualDurableRetry(account, epoch, thread.id, requestId);
        settleDurableRequest(account, epoch, result);
        options.onSettled?.(result.status === 'success' && !!result.response?.reply, result.error?.message);
        return;
      }
      if (typeof result.reply !== 'string') throw new UncertainDeliveryError('Uony no ha devuelto una respuesta verificable.');
      forgetManualDurableRetry(account, epoch, thread.id, requestId);
      const current = useWorkspaceStore.getState();
      current.pushMessage(thread.id,{ role:'assistant',requestId,text:result.reply,model:result.model,effort:result.effort,productChanges:result.productChanges,connectionActions:connectionActionsOf(result.connectionActions,'assistant'),conversationForm:conversationFormOf(result.conversationForm,'assistant'),materialAnalysis:materialAnalysisOf(result.materialAnalysis,'assistant'),productIntake:productIntakeOf(result.productIntake,'assistant'),productProposal:productProposalForThread(result.productProposal,'assistant',thread.id),conversationFormFresh:current.activeThreadId === thread.id });
      if (result.productChanges?.length) notifyProductChanges(result.productChanges);
      if (options.incidentAction || guide?.kind === 'product_incident') window.dispatchEvent(new Event('uonify:product-incidents-changed'));
      if (options.materialAction || guide?.kind === 'drive_analysis') window.dispatchEvent(new Event('uonify:product-materials-changed'));
      if (instructionMaterialAnalysisOf(materialAnalysisOf(result.materialAnalysis, 'assistant'))?.assignmentId)
        window.dispatchEvent(new CustomEvent('uonify:assignment-work-changed',
          { detail: { account, threadId: thread.id } }));
      announce(`Uony: ${result.reply}`); emitAssistantReply(result.reply,{ threadId:thread.id });
      options.onSettled?.(true);
      if (guide?.kind === 'product_guide' && guide.section === 'choice' && options.formResponse?.answers.mode === 'Módulo Producto'
        && useWorkspaceStore.getState().activeThreadId === thread.id
        && result.productChanges?.some(change => change.product.sku === guide.sku)) {
        openWorkspacePage(`/espacio/producto/${encodeURIComponent(guide.sku)}`);
      }
    })
    .catch(error => {
      if (!sameIdentity()) return;
      if (possiblyDurable && uncertainDelivery(error)) {
        const composer = useComposerStore.getState();
        composer.setThreadStatus(thread.id, DURABLE_POST_UNCERTAIN);
        if (!composer.status || composer.statusThreadId === thread.id) composer.setStatus(DURABLE_POST_UNCERTAIN, thread.id);
        if (!watching) follow(true);
        return;
      }
      if (retry) forgetManualDurableRetry(account, epoch, thread.id, requestId);
      const wasActive = useWorkspaceStore.getState().activeThreadId === thread.id;
      const recovery = connectionRecovery(error);
      // Lote 6 (dueño): ningún error bajo el compositor. Sin tarjeta de conexión, el hilo se
      // queda (aunque vacío) para la respuesta de Uony; con ella, la bienvenida la muestra como antes.
      useWorkspaceStore.getState().withdrawLastMessage(thread.id, !!options.productLink || !wasActive || !recovery);
      if (wasActive && recovery) useConversationRecovery.setState({ recovery: { ...recovery, account, threadId: useWorkspaceStore.getState().activeThreadId } });
      const assignmentConflict = error instanceof ApiError && error.status === 409
        && ['assignment_focus_conflict', 'assignment_focus_required']
          .includes(String((error.data as { error?: unknown } | null)?.error));
      const message = assignmentConflict
        ? 'No hemos podido confirmar el encargo de esta conversación. Conservamos tu texto; revisa el encargo antes de enviarlo otra vez.'
        : options.productLink && error instanceof ApiError && error.status === 409
        ? `${errorMessage(error)} Vuelve a elegir la ficha desde Producto para confirmar sus datos actuales.` : errorMessage(error);
      const retained = useWorkspaceStore.getState().threads.some(item => item.id === thread.id);
      // Sin repetir lo que ya dice la tarjeta de conexión; el hilo guardado para el aviso no se pierde al releer.
      if (retained && !(wasActive && recovery)) noticeInConversation(thread.id, message);
      if (retained && (!wasActive || !recovery)) {
        const linkConflict = !!options.productLink && error instanceof ApiError && error.status === 409;
        const link = options.productLink && !linkConflict
          ? { ...options.productLink, threadId: thread.id, requestId, expectedVersion } : null;
        const recoveryText = linkConflict ? (preservedProductLink ? '' : preservedDraft)
          : options.productLink ? text : options.preserveDraft || structured ? preservedDraft : text;
        rememberThreadDraft(account, epoch, thread.id, recoveryText,
          linkConflict ? null : link ?? (options.preserveDraft ? preservedProductLink : null));
      }
      if (useWorkspaceStore.getState().activeThreadId === thread.id || !useWorkspaceStore.getState().activeThreadId) {
        if (!options.preserveDraft && !useComposerStore.getState().draft) {
          if (options.productLink && !(error instanceof ApiError && error.status === 409)) {
            useComposerStore.getState().prepareProductLink({ ...options.productLink, threadId: thread.id, requestId, expectedVersion });
          } else if (!structured || options.productLink) useComposerStore.getState().setDraft(text);
          else if (preservedDraft) useComposerStore.getState().setDraft(preservedDraft);
        }
      }
      if (assignmentConflict) window.dispatchEvent(new CustomEvent('uonify:assignment-focus-conflict', {
        detail: { account, threadId: thread.id },
      }));
      if (options.requirementsAction) options.onSettled?.(false, errorMessage(error), error instanceof ApiError && error.status === 409
        ? 'conflict' : error instanceof ApiError && error.status >= 400 && error.status < 500
          && error.status !== 408 && error.status !== 429 ? 'definitive'
          : uncertainDelivery(error) ? 'uncertain' : 'failed');
      else options.onSettled?.(false, errorMessage(error));
    })
    .finally(() => {
      if (sameIdentity() && !watching && useUiStore.getState().pendingReply?.requestId === requestId) setUi({pendingReply:null});
    });
  return true;
}
/** Mantiene hilo, identidad y borrador al iniciar una corrección desde Producto. */
export function startIncidentResolution(incidentId: string, action: 'start' | 'check' = 'start'): boolean {
  setChatPanel(true);
  const accepted = sendLivePrompt(action === 'check' ? 'Comprueba el estado de esta incidencia en Amazon.' : 'Ayúdame a resolver esta incidencia de Amazon.', {
    preserveDraft: true, incidentAction: { incidentId, action },
  });
  focusComposer();
  return accepted;
}
export function startMaterialReview(sku: string, analysisId: string): boolean {
  setChatPanel(true);
  const accepted = sendLivePrompt('Utiliza los materiales de este producto para completar los requisitos de Amazon y pregúntame solo por los datos que falten.', {
    preserveDraft: true, materialAction: { action: 'review', sku, analysisId },
  });
  focusComposer();
  return accepted;
}
/** Reevalúa una guía sin aplicar borradores anteriores ni depender de un mensaje libre. */
export function prepareProductRequirements(sku: string, options: { retry?: boolean; acknowledgeUnknown?: boolean;
  expectedRevision?: number; expectedLinkVersion?: number;
  expectedReasoningId?: string; expectedReasoningStatus?: 'error' | 'unknown';
  expectedSourceFingerprint?: string;
  requestId?: string; expectedThreadId?: string; expectedProjectId?: string | null;
  onSettled?: LivePromptOptions['onSettled'] } = {}): boolean {
  const { onSettled, requestId, expectedThreadId, expectedProjectId, ...action } = options;
  return sendLivePrompt(options.retry ? 'Vuelve a revisar mis documentos con Uony para completar los datos de Amazon.' : 'Actualiza las preguntas de este producto con lo que ya sabemos para Amazon.', {
    preserveDraft: true, requirementsAction: { action: 'prepare', sku, ...action },
    requestId, expectedThreadId, expectedProjectId, onSettled,
  });
}
if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  useConversationRecovery.setState({ recovery: null });
});
