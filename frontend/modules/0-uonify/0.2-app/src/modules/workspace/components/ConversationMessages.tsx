import { USE_MOCKS } from '@/shared/api/config';
import { GuideCard } from '@/modules/catalog';
import { IntakeDriveAnalysis, ProductDriveAnalysis } from '@/modules/drive';
import { useSession } from './authBridge';
import { sendPrompt } from '../hooks/conversation';
import { focusComposer, openWorkspacePage } from '../hooks/actions';
import { openGuidedProduct, pauseGuidedWork } from '../hooks/guidedConversation';
import { Fragment, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/shared/ui';
import { notifyProductChanges } from '@/shared/pim';
import { useRegisterRef, useUiStore } from '../hooks/uiStore';
import { useWorkspaceRoute } from '../hooks/useWorkspaceRoute';
import { activeThreadOf, useWorkspaceStore } from '../hooks/workspaceStore';
import { useLiveTranscriptPreview } from '../hooks/liveTranscriptPreview';
import { useVoiceSubtitles } from '../hooks/voiceSubtitles';
import { SERVICES } from '../model/services';
import { playEnter } from '../model/motion';
import { connectionActionsOf, type ConnectionProvider } from '../model/connectionActions';
import { NEXUS_APPS } from '../model/nexusCatalog';
import { ConversationStarters } from './ConversationStarters';
import { ConversationConnection } from './ConversationConnection';
import { ConversationForm } from './ConversationForm';
import { conversationFormOf, isRequirementsProgress } from '../model/conversationForm';
import { ConversationRequirementsProgress } from './ConversationRequirementsProgress';
import { activeRequirementsProgressIndex } from '../model/requirementsConversation';
import { startMaterialReview, useConversationRecovery } from '../hooks/liveConversation';
import { instructionMaterialAnalysisOf, materialAnalysisOf, productMaterialAnalysisOf, showInstructionDriveJob } from '../model/materialAnalysis';
import { productIntakeOf } from '../model/productIntake';
import { productProposalForThread } from '../model/productProposal';
import { estudioCardOf } from '../model/estudioCard';
import { ConversationEstudioCard } from './ConversationEstudioCard';
import { estudioClipWiringEnabled } from '../model/estudioFlags';
import { EstudioClipEntry } from './EstudioClipEntry';
import { ConversationRecovery } from './ConversationRecovery';
import { ConversationFollowUpCards } from './ConversationFollowUpCards';
import { ConversationProductProposal } from './ConversationProductProposal';
import { ConversationDriveJob } from './ConversationDriveJob';
import { VoiceSubtitles } from './voice/VoiceSubtitles';
import { isReturnRetryRequest } from '../api/returnRetryIntent';
import { slowThinkingFor, useSlowThinking, useSlowThinkingTimer } from '../hooks/slowThinking';
import type { ProductProposalReceipt } from '../api/productProposals';
import '../styles/conversation-connections.css';
import '../styles/conversation-reply-brand.css';

function productProposalConfirmed(receipt: ProductProposalReceipt) {
  if (receipt.status === 'approved') notifyProductChanges(receipt.productChanges);
}

/**
 * Mensajes del hilo activo, con la antesala de la respuesta («Revisando tu petición…»,
 * «Abriendo Producto…») y el vacío según dónde esté la conversación.
 */
export function ConversationMessages({ centredInService, questionTarget = null, questionEnabled = true }: { centredInService: boolean; questionTarget?: HTMLElement | null; questionEnabled?: boolean }) {
  const thread = useWorkspaceStore(activeThreadOf);
  const historyAccount = useWorkspaceStore(state => state.historyAccount);
  const historyEpoch = useWorkspaceStore(state => state.historyEpoch);
  const assistantPreview = useLiveTranscriptPreview(state => state.previews.findLast(item => item.role === 'assistant'
    && item.threadId === thread?.id && item.account === historyAccount && item.epoch === historyEpoch));
  const livePreviews = useLiveTranscriptPreview(state => state.previews);
  const allPendingUsers = useLiveTranscriptPreview(state => state.pendingUsers);
  const pendingUsers = allPendingUsers.filter(item => item.ended
    && item.threadId === thread?.id && item.account === historyAccount && item.epoch === historyEpoch);
  const pendingVisualKey = pendingUsers.map(item => `${item.turnId}:${item.unavailable ? 'unavailable' : 'waiting'}:${livePreviews.find(preview => preview.role === 'user'
    && preview.turnId === item.turnId && preview.threadId === item.threadId)?.text ?? ''}`).join('|');
  const canonicalLiveTurns = new Set(thread?.messages.filter(message => message.role === 'assistant'
    && !!message.requestId && !!message.sourceLiveTurnId).map(message => message.sourceLiveTurnId));
  const showUnlinkedAssistantPreview = !!assistantPreview && !pendingUsers.length
    && !assistantPreview.replyToTurnId;
  const assistantPreviewFor = (userTurnId?: string) => userTurnId && assistantPreview?.replyToTurnId === userTurnId
    && !canonicalLiveTurns.has(userTurnId)
    && !thread?.messages.some(message => message.role === 'assistant' && message.turnId === assistantPreview.turnId)
    ? <div key={`${thread?.id}:live:assistant:${assistantPreview.turnId}`} className="message assistant is-uony-reply"
      aria-label="Uony está respondiendo">{assistantPreview.text}</div> : null;
  const account = useSession().user?.email;
  const pending = useUiStore(state => state.pendingReply);
  const { service } = useWorkspaceRoute();
  const thinking = thread && pending?.threadId === thread.id ? pending : null;
  // F1-S (lote 8): la respuesta escrita crece mientras Uony la escribe; la sustituye la definitiva.
  const provisional = useUiStore(state => state.provisionalReply);
  const writing = thinking?.requestId && provisional?.requestId === thinking.requestId
    && provisional.threadId === thread?.id
    && !thread?.messages.some(message => message.role === 'assistant' && message.requestId === provisional.requestId)
    ? provisional : null;
  // Lote 9: sin texto a los 20 s, «Uony está pensando…» ocupa el sitio de la respuesta.
  useSlowThinkingTimer();
  const slowThinking = useSlowThinking(slowThinkingFor(thread?.id)) && !!thinking && !writing;
  const requirementsPending = !USE_MOCKS && !!thinking?.requirements;
  const requirementsProgressIndex = thread ? activeRequirementsProgressIndex(thread.messages) : -1;
  const answeringForm = requirementsPending && !!questionTarget && !!account && thread?.messages.some(entry => {
    const form = conversationFormOf(entry.conversationForm, entry.role);
    return !!form && form.id === thinking?.requirements?.formId && form.context?.kind === 'product_guide'
      && form.context.section === 'amazon_requirements';
  });
  const recoveryState = useConversationRecovery(state => state.recovery);
  const recovery = recoveryState && recoveryState.account === account && recoveryState.threadId === (thread?.id ?? null) ? recoveryState : null;
  // La voz (PIEZA 2) escribe subtítulos FUERA de thread.messages. Esta «marca» de los subtítulos del hilo
  // activo reactiva el seguimiento del scroll para que la vista acompañe el último subtítulo según se escribe.
  const subtitleTick = useVoiceSubtitles(state => {
    let tick = 0;
    for (const turn of state.turns) {
      if (turn.threadId === thread?.id && turn.account === historyAccount && turn.epoch === historyEpoch) {
        tick += turn.text.length + (turn.finished ? 1 : 0);
      }
    }
    return tick;
  });

  const list = useRef<HTMLDivElement>(null);
  const currentConnections = useRef<Partial<Record<ConnectionProvider, HTMLDivElement | null>>>({});
  const actionsByMessage = !USE_MOCKS && account ? thread?.messages.map(entry => connectionActionsOf(entry.connectionActions, entry.role)) ?? [] : [];
  const lastConnectionIndex = new Map<ConnectionProvider, number>();
  actionsByMessage.forEach((actions, index) => actions?.forEach(action => lastConnectionIndex.set(action.provider, index)));
  const lastIntakeIndex = new Map<string, number>();
  const lastInstructionJobIndex = new Map<string, number>();
  thread?.messages.forEach((entry, index) => {
    const intake = productIntakeOf(entry.productIntake, entry.role);
    if (intake) lastIntakeIndex.set(intake.id, index);
    const instruction = instructionMaterialAnalysisOf(materialAnalysisOf(entry.materialAnalysis, entry.role));
    if (instruction) lastInstructionJobIndex.set(instruction.jobId, index);
  });
  const previous = useRef<{ id?: string; count: number; pending: boolean; preview?: string; writing?: string } | null>(null);
  const followLatest = useRef(true);
  const shouldFollowScroll = useCallback(() => followLatest.current, []);
  useRegisterRef('messages', list);

  // Animar solo una entrega nueva, nunca el historial al cambiar de hilo o módulo.
  useLayoutEffect(() => {
    const before = previous.current;
    const count = thread?.messages.length ?? 0;
    const latest = thread?.messages.at(-1);
    const delivered = !thinking && latest?.role === 'assistant' && !isRequirementsProgress(conversationFormOf(latest.conversationForm, latest.role)) && before?.id === thread?.id
      && (count > (before?.count ?? count) || before?.pending);
    const changedThread = before?.id !== thread?.id;
    const ownMessage = !changedThread && count > (before?.count ?? count) && latest?.role === 'user';
    const previewChanged = !changedThread && (before?.preview !== assistantPreview?.text || before?.writing !== writing?.text);
    // Lo que ya se leyó mientras se escribía no vuelve a entrar ni mueve la lectura (maqueta A).
    const written = delivered && !!before?.writing;
    previous.current = { id: thread?.id, count, pending: Boolean(thinking), preview: assistantPreview?.text, writing: writing?.text };
    const element = list.current;
    if (element) {
      const card = element.querySelector<HTMLElement>('.uony-guide');
      const replies = element.querySelectorAll<HTMLElement>('.message.assistant:not(.is-thinking):not(.is-thinking-slow)');
      const reply = replies.item(replies.length - 1);
      if (delivered) {
        if (!written) playEnter(reply, 'uon-reply-text');
        playEnter(card, 'uon-reply-card');
      }
      // Una respuesta o actualización no debe desplazar a quien está leyendo mensajes anteriores.
      if (changedThread || ownMessage || followLatest.current) {
        const anchor = ownMessage || previewChanged || written ? null : delivered ? reply : !thinking ? card : null;
        element.scrollTop = anchor ? anchor.offsetTop - element.offsetTop : element.scrollHeight;
        if (changedThread || ownMessage) followLatest.current = true;
      }
    }
  }, [thread?.id, thread?.messages, thinking, assistantPreview?.text, writing?.text, pendingVisualKey]);

  // Pin-to-bottom de la voz: al llegar o crecer un subtítulo, si el usuario está al fondo, la vista sigue el
  // último contenido. Respeta la lectura manual: si subió a leer el historial, followLatest es falso y no se fuerza.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && followLatest.current) element.scrollTop = element.scrollHeight;
  }, [subtitleTick]);

  const isEmpty = !thread?.messages.length && !thinking && !recovery && !assistantPreview && !pendingUsers.length;
  const pendingAt = (index: number) => pendingUsers.filter(item =>
    index === (thread?.messages.length ?? 0) ? item.anchorIndex >= index : item.anchorIndex === index)
    .filter(item => !thread?.messages.some(message => message.role === 'user' && message.turnId === item.turnId))
    .map(item => {
      const spoken = livePreviews.find(preview => preview.role === 'user' && preview.turnId === item.turnId
        && preview.threadId === item.threadId && preview.account === item.account && preview.epoch === item.epoch)?.text;
      return <Fragment key={`${item.threadId}:live:user:pending:${item.turnId}`}>
        <div className="message user" aria-label="Transcripción de voz pendiente">{spoken || (item.unavailable
          ? 'No disponible la transcripción de este turno' : 'Transcribiendo tu voz…')}</div>
        {assistantPreviewFor(item.turnId)}
      </Fragment>;
    });
  let empty: string | null = null;
  if (isEmpty) {
    if (service === 'producto' && centredInService) empty = 'Importa tus productos, crea uno nuevo o cuéntame qué quieres subir y lo preparo contigo.';
    else if (service) empty = `Pídele a Uony lo que necesites en ${SERVICES[service].name}.`;
  }

  return (
    <div className={`conversation-messages${thinking ? ' is-pending' : ''}`} id="conversation-messages" ref={list} aria-busy={Boolean(thinking)}
      onScroll={event => {
        const element = event.currentTarget;
        followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 56;
      }}>
      {thread?.messages.map((entry, index) => {
        if (entry.role === 'assistant' && !!entry.turnId && !entry.requestId
          && (entry.supersededByHandoff || !!entry.replyToTurnId && canonicalLiveTurns.has(entry.replyToTurnId))) {
          return <Fragment key={`${thread.id}:live:superseded:${entry.turnId}`}>{pendingAt(index)}</Fragment>;
        }
        const form = conversationFormOf(entry.conversationForm, entry.role);
        const intake = productIntakeOf(entry.productIntake, entry.role);
        const analysis = materialAnalysisOf(entry.materialAnalysis, entry.role);
        const productAnalysis = productMaterialAnalysisOf(analysis);
        const instructionAnalysis = instructionMaterialAnalysisOf(analysis);
        const showJob = showInstructionDriveJob(instructionAnalysis);
        const proposal = !USE_MOCKS && account && historyAccount === account
          ? productProposalForThread(entry.productProposal, entry.role, thread.id) : undefined;
        const estudio = !USE_MOCKS && account ? estudioCardOf(entry.estudioCard, entry.role) : undefined;
        const connections = account ? actionsByMessage[index]?.map(({ provider }) => {
            const accountAction = provider === 'account';
            const name = accountAction ? 'tu cuenta' : NEXUS_APPS.find(app => app.id === provider)?.name ?? provider;
            return index === lastConnectionIndex.get(provider) ? (
              <div key={provider} className="message-connection" ref={element => { currentConnections.current[provider] = element; }} tabIndex={-1} aria-label={accountAction ? 'Eliminación de cuenta en esta conversación' : `Conexión actual de ${name}`}>
                <ConversationConnection key={`${account}:${thread.id}:${provider}`} account={account} provider={provider} />
              </div>
            ) : (
              <div key={provider} className="message-connection-history">
                <span>{accountAction ? 'La gestión de tu cuenta continúa en su última tarjeta.' : `La gestión de ${name} continúa en su último mensaje de conexión.`}</span>
                <button type="button" onClick={() => {
                  currentConnections.current[provider]?.scrollIntoView({ block: 'nearest' });
                  currentConnections.current[provider]?.focus({ preventScroll: true });
                }}>{accountAction ? 'Ver gestión de cuenta' : `Ver conexión actual de ${name}`}</button>
              </div>
            );
          }) : undefined;
        if (!USE_MOCKS && isRequirementsProgress(form)) return <Fragment key={`${thread.id}:${index}`}>
          {pendingAt(index)}
          {account && !requirementsPending && index === requirementsProgressIndex && <ConversationRequirementsProgress
            key={`${account}:${thread.id}:${form!.id}`} form={form!} account={account} threadId={thread.id} active questionTarget={questionTarget} />}
          {!!connections?.length && <div className="message assistant has-connection">{connections}</div>}
        </Fragment>;
        const informationalQuestion = entry.role === 'assistant' && form?.fields.length === 1
          && !form.review?.length && !form.notice && form.context?.kind !== 'product_incident' && form.context?.kind !== 'drive_analysis'
          && !form.fields[0].resourceEvidence && !form.fields[0].suggestion;
        const reply = entry.text.trim();
        const fieldLabel = form?.fields[0]?.label ?? '';
        const usefulQuestion = informationalQuestion && (!reply || reply === 'Completa estos datos para continuar.') ? fieldLabel
          : informationalQuestion && reply.length <= 180 && !/[¿?]/.test(reply)
            && !reply.toLocaleLowerCase().includes(fieldLabel.toLocaleLowerCase()) ? `${reply}\n${fieldLabel}` : entry.text;
        const brandedReply = entry.role === 'assistant' && !entry.requestStatus && !actionsByMessage[index]?.length
          && !productAnalysis && !showJob && !intake && !proposal && !estudio;
        return (
        <Fragment key={entry.turnId ? `${thread.id}:live:${entry.role}:${entry.turnId}` : `${thread.id}:${index}`}>
        {pendingAt(index)}
        <div className={`message ${entry.role === 'user' ? 'user' : 'assistant'}${actionsByMessage[index]?.length || productAnalysis || showJob || intake ? ' has-connection' : ''}${form ? ' has-form' : ''}${form && form.context?.kind !== 'drive_analysis' && form.context?.kind !== 'product_incident' ? ' has-question' : ''}${proposal ? ' has-proposal' : ''}${brandedReply ? ' is-uony-reply' : ''}`}>
          {/* Aunque Uony la esté diciendo en voz alta, la respuesta se ve entera y quieta
              desde que llega (decisión del dueño, 20-10-2026: el revelado al ritmo del audio parpadeaba). */}
          {proposal && account ? <ConversationProductProposal account={account} threadId={thread.id}
            proposal={proposal} originalText={entry.text} onConfirmed={productProposalConfirmed} /> : usefulQuestion}
          {!USE_MOCKS && entry.productChanges?.map(change => <button key={change.product.sku} type="button" className="message-product-link" onClick={() => openWorkspacePage(`/espacio/producto/${encodeURIComponent(change.product.sku)}`)}>Abrir ficha · {change.product.name}</button>)}
          {/* D-PROTECCIÓN: el pie NUNCA muestra el motor real ni el nivel de razonamiento (eran «Gemini 3.5 Flash · Medio»).
              Solo marca «Uony»; los dos roles propios ya eran seguros. El motor elegido sigue visible donde el dueño lo decide (el selector del redactor). */}
          {!USE_MOCKS && entry.role==='assistant' && entry.model && !entry.requestStatus && <small className="uony-response-model">{entry.model === 'uonify-guide' ? 'Uony · Guía de producto' : entry.model === 'uonify-creative' ? 'Uony · Plan creativo' : 'Uony'}</small>}
          {connections}
          {!USE_MOCKS && account && conversationFormOf(entry.conversationForm, entry.role) && <ConversationForm
            key={`${account}:${thread.id}:${index}:${entry.conversationForm!.id}`}
            form={conversationFormOf(entry.conversationForm, entry.role)!} account={account} threadId={thread.id} messageIndex={index}
            active={index === thread.messages.length - 1} autoOpen={entry.conversationFormFresh} questionTarget={questionTarget} questionEnabled={questionEnabled} />}
          {!USE_MOCKS && account && productAnalysis && <ProductDriveAnalysis account={account}
            sku={productAnalysis.sku} revision={productAnalysis.revision} disabled={!!pending}
            chat={{ threadId: thread.id, isCurrent: () => useWorkspaceStore.getState().activeThreadId === thread.id
              && useWorkspaceStore.getState().historyAccount === account }}
            onReview={analysisId => useWorkspaceStore.getState().activeThreadId === thread.id && startMaterialReview(productAnalysis.sku, analysisId)} />}
          {!USE_MOCKS && account && instructionAnalysis && showJob
            && lastInstructionJobIndex.get(instructionAnalysis.jobId) === index && <ConversationDriveJob
              account={account} threadId={thread.id} jobId={instructionAnalysis.jobId} intakeId={instructionAnalysis.intakeId} />}
          {!USE_MOCKS && account && intake && lastIntakeIndex.get(intake.id) === index && <IntakeDriveAnalysis
            account={account} threadId={thread.id} id={intake.id} revision={intake.revision} disabled={!!pending}
            isCurrent={() => useWorkspaceStore.getState().activeThreadId === thread.id
              && useWorkspaceStore.getState().historyAccount === account}
            onReview={(sku, analysisId) => useWorkspaceStore.getState().activeThreadId === thread.id && startMaterialReview(sku, analysisId)} />}
          {estudio && <ConversationEstudioCard card={estudio} active={index === thread.messages.length - 1} />}
        </div>
        {entry.role === 'user' && assistantPreviewFor(entry.turnId)}
        </Fragment>
        );
      })}
      {pendingAt(thread?.messages.length ?? 0)}
      {/* PIEZA 2 · subtítulos de voz (solo vista, canal propio): vacío hasta que llega `subtitle`. */}
      {!USE_MOCKS && historyAccount && thread && <VoiceSubtitles account={historyAccount} epoch={historyEpoch} threadId={thread.id} />}
      {showUnlinkedAssistantPreview && assistantPreview && !thread?.messages.some(message => message.role === 'assistant' && message.turnId === assistantPreview.turnId)
        && <div key={`${thread?.id}:live:assistant:${assistantPreview.turnId}`} className="message assistant is-uony-reply"
          aria-label="Uony está respondiendo">{assistantPreview.text}</div>}
      {slowThinking && <div key={`${thread?.id}:thinking`} className="message assistant is-uony-reply is-thinking-slow"
        role="status" aria-live="polite"><span className="conversation-active-dot" aria-hidden="true" />Uony está pensando…</div>}
      {writing && <div key={`${thread?.id}:written:${writing.requestId}`} className="message assistant is-uony-reply is-writing"
        aria-label="Uony está escribiendo">{writing.text}<span className="uony-writing-caret" aria-hidden="true" /></div>}
      {!USE_MOCKS && account && historyAccount === account && thread && <ConversationFollowUpCards key={`${account}:${thread.id}`}
        account={account} threadId={thread.id}
        shouldFollowScroll={shouldFollowScroll}
        suspended={!!thinking && !(thinking.requestId && isReturnRetryRequest(account, thread.id, thinking.requestId))} />}
      {/* ANDAMIO clip simple (Opción A, interfaz 28-10): entrada del Estudio con su propia subida, tras el flag
          `estudioClipWiringEnabled` (apagado por defecto; `?estudio=clip` para el test). Backend inerte → «sin precio»,
          «Crear» deshabilitado, 0 gasto. La costura conversacional de producción la monta interfaz después. */}
      {estudioClipWiringEnabled() && !USE_MOCKS && account && thread && <EstudioClipEntry threadId={thread.id} />}
      {USE_MOCKS && thread && <GuideCard threadId={thread.id} send={text => { sendPrompt(text); }} openProduct={sku => openGuidedProduct(thread.id, sku)} requestChanges={focusComposer} pause={() => pauseGuidedWork(thread.id)} />}
      {requirementsPending && !answeringForm && questionTarget ? createPortal(
        <section className="uony-reasoning-panel" aria-label="Preparación de los datos de Amazon">
          <div className="amazon-reasoning"><header className="amazon-reasoning-heading"><Icon name="uony" size={20} /><strong>Uony está preparando tus datos</strong></header>
            <p role="status">{thinking?.label}</p></div>
        </section>, questionTarget) : null}
      {(thread || service) && <ConversationRecovery />}
      {isEmpty && !service ? <ConversationStarters /> : empty ? <p className="conversation-empty">{empty}</p> : null}
    </div>
  );
}
