import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { ApiError, errorMessage } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { useOwnedRequest } from '@/shared/hooks';
import { focusComposer } from '../hooks/actions';
import { useUiStore } from '../hooks/uiStore';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import type { ProductChange } from '@/shared/pim';
import { getLatestAmazonSnapshot, getReturnBrief, prepareAmazonSnapshot,
  createReturnFollowUpIntent, postReturnFollowUp, type AmazonPublicationPhase, type AmazonSnapshot,
  type ConfirmedFact, type ReturnBrief, type ReturnFollowUpAction, type ReturnFollowUpIntent } from '../api/conversationCards';
import { getAssignmentReturn } from '../api/assignmentReturn';
import { ConversationAssignmentReturn } from './ConversationAssignmentReturn';
import { useAssignmentFocusSelection } from '../hooks/useAssignmentFocusSelection';
import { requestsAssignmentReturn, showAssignmentReturn } from '../model/assignmentReturnVisibility';
import { ConversationReturnGuidance, returnGuidanceMode } from './ConversationReturnGuidance';
import { clearReturnRetryConflict, hasReturnRetryConflict, isReturnRetryRequest,
  reconcileReturnRetryIntent, returnRetryIntents } from '../api/returnRetryIntent';
import { clearAllReturnPreparationDrafts, visibleReturnPreparationDrafts } from '../api/returnPreparationDraft';

interface Props { account: string; threadId: string; suspended: boolean; shouldFollowScroll?: () => boolean }
const alwaysFollowScroll = () => true;

function selectedFacts(facts: ConfirmedFact[]): ConfirmedFact[] {
  const rank = (fact: ConfirmedFact) => {
    const name = `${fact.id} ${fact.label}`.toLocaleLowerCase('es');
    if (/peso|weight/.test(name)) return 0;
    if (/pvpr|precio recomendado|list.price/.test(name)) return 1;
    if (/público|destinatario|adult|famil/.test(name)) return 2;
    if (/mercancía.peligros|dangerous.good/.test(name)) return 3;
    return 4;
  };
  return facts.map((fact, index) => ({ fact, index })).sort((a, b) => rank(a.fact) - rank(b.fact) || a.index - b.index)
    .slice(0, 4).map(item => item.fact);
}

function nextStep(brief: ReturnBrief): string {
  const publication = publicationMode(brief);
  if (publication === 'tracking') return brief.status?.amazonPublicationDetail?.newerLocalDraft
    ? 'Conciliar el intento guardado y revisar la vista previa local más reciente.'
    : 'Revisar el seguimiento de Amazon en esta conversación.';
  if (publication === 'approved') return brief.status?.amazonPublicationDetail?.newerLocalDraft
    ? 'Revisar la vista previa local más reciente antes de usar la aprobación guardada.'
    : 'Continuar con la aprobación guardada en esta conversación.';
  if (publication === 'unknown') return 'Continuar en esta conversación y comprobar el estado de Amazon.';
  if (canReviewAmazon(brief)) return 'Revisar el borrador para Amazon.';
  if (brief.pending[0]?.followUp === 'open') return brief.pending[0].label;
  const labels: Record<string, string> = {
    wait_for_analysis: 'Esperar el análisis de materiales ya iniciado.',
    wait_for_ai: 'Esperar la revisión de IA ya iniciada.',
    reconnect_drive: 'Restablecer el acceso a los materiales guardados.',
    review_materials: 'Revisar los materiales de la ficha.',
    review_ai: 'Revisar la comprobación de IA guardada.',
    review_amazon_requirements: brief.status?.amazonRequirements === 'not_started'
      ? 'Elegir el siguiente trabajo para esta ficha.' : 'Revisar los requisitos guardados de Amazon.',
    review_preparation: 'Revisar los apartados guardados de la ficha.',
    continue_in_chat: 'Continuar en esta conversación.',
  };
  return labels[brief.nextAction] ?? 'Continuar en esta conversación.';
}

function publicationMode(brief: ReturnBrief): 'local' | 'approved' | 'tracking' | 'unknown' {
  const phase = brief.status?.amazonPublication;
  if (brief.status?.amazonPublicationDetail?.attemptId) return 'tracking';
  if (phase === 'not_started' || phase === 'local_draft') return 'local';
  if (phase === 'approved_not_sent') return 'approved';
  return phase && Object.prototype.hasOwnProperty.call(publicationCopy, phase) ? 'tracking' : 'unknown';
}

const publicationCopy: Partial<Record<AmazonPublicationPhase, string>> = {
  reserved: 'Hay un intento reservado; el resultado del envío aún no está comprobado.',
  rejected_initial: 'Amazon rechazó inicialmente el intento guardado. Revisa sus observaciones.',
  outcome_unknown: 'El resultado del envío es incierto. Hace falta conciliar ese intento.',
  awaiting_amazon: 'El envío se aceptó inicialmente; el estado de la ficha sigue sin comprobarse.',
  checking: 'La comprobación del estado de la ficha está en curso.',
  check_failed: 'La última comprobación falló; la visibilidad actual no está acreditada.',
  visibility_check_stale: 'Una observación anterior ya no acredita la visibilidad actual.',
  not_found: 'La última consulta no encontró la ficha.',
  listing_present: 'Se encontró una ficha, pero su visibilidad no está comprobada.',
  issues: 'La última consulta encontró incidencias en la ficha.',
  unmatched: 'La ficha observada no coincide con la revisión aprobada.',
  visible_current: 'Una consulta reciente observó una ficha visible con atributos coincidentes; no verifica un enlace de compra ni demuestra que este envío la creara.',
};

function publicationText(brief: ReturnBrief): string | null {
  const mode = publicationMode(brief);
  const detail = brief.status?.amazonPublicationDetail;
  const newer = detail?.newerLocalDraft ? ' Hay una vista previa local más reciente; la evidencia guardada corresponde a otra vista.' : '';
  if (mode === 'unknown') return 'El estado de Amazon no está disponible en este momento.';
  if (mode === 'approved') return (detail?.matchesProductRevision === false
    ? 'Hay una aprobación guardada para una revisión anterior; no consta un intento de envío desde Uonify.'
    : 'Hay una aprobación guardada; no consta un intento de envío desde Uonify.') + newer;
  if (mode !== 'tracking') return null;
  const phase = brief.status?.amazonPublication;
  const status = phase ? publicationCopy[phase] : null;
  return `${status ?? 'Hay un intento de envío registrado que necesita seguimiento.'}${detail?.matchesProductRevision === false ? ' Corresponde a una revisión anterior de la ficha.' : ''}${newer}`;
}

function canReviewAmazon(brief: ReturnBrief): boolean {
  const status = brief.status?.amazonRequirements;
  return publicationMode(brief) === 'local' && ['needs_input', 'locally_valid_not_published'].includes(status ?? '')
    && !brief.pending.some(item => item.followUp === 'open');
}

type FollowUpStatus = 'busy' | 'conflict' | 'refresh' | 'refresh_failed' | 'rejected' | 'retry' | null;

function ReturnCard({ brief, account, threadId, openPreview, continueChat, followUpStatus, onFollowUp,
  onRefresh, onRetryConflict, retryConflict, refreshing = false }: {
  brief: ReturnBrief; account: string; threadId: string;
  openPreview: () => void; continueChat: () => void; followUpStatus: FollowUpStatus;
  onFollowUp: (action: ReturnFollowUpAction, pendingId: string) => void; onRefresh: () => void;
  onRetryConflict: () => void; retryConflict: boolean; refreshing?: boolean;
}) {
  const product = brief.product!;
  const facts = selectedFacts(brief.confirmedFacts);
  const reviewAmazon = canReviewAmazon(brief);
  const amazonStatus = publicationText(brief);
  const needsRefresh = retryConflict || followUpStatus === 'conflict' || followUpStatus === 'refresh'
    || followUpStatus === 'refresh_failed' || followUpStatus === 'rejected';
  const open = brief.pending.find(item => item.followUp === 'open');
  const completed = open ? undefined : brief.completedFollowUps.find(item => item.canResolve);
  const guidance = returnGuidanceMode(brief);
  const localDrafts = visibleReturnPreparationDrafts(account, threadId, product.sku)
    .filter(item => !(guidance === 'preparation' && item.scope.revision === product.revision
      && item.scope.sectionId === open?.id.split(':')[1]));
  return <section className="conversation-followup-card" aria-label={`Resumen de ${product.name}`}>
    <h2>Retomemos {product.name}</h2>
    {facts.length > 0 ? <p><strong>Ya confirmado:</strong> {facts.map(fact => `${fact.label}: ${fact.value}`).join(' · ')}.</p>
      : <p>La ficha sigue guardada. Aún no hay datos confirmados para resumir aquí.</p>}
    {brief.confirmedFacts.length > facts.length && <p>Hay más datos confirmados en la ficha; se conservan para continuar.</p>}
    {needsRefresh ? <div className="conversation-followup-notice" role="status">
      <strong>{retryConflict || followUpStatus === 'conflict' ? 'El resumen ha cambiado.' : 'Hay que actualizar el resumen.'}</strong>
      {' '}{retryConflict ? 'No se ha iniciado otra revisión. Consulta la ficha y el trabajo guardado antes de decidir.'
        : followUpStatus === 'conflict' ? 'No se ha aplazado ni cerrado ningún seguimiento. Consulta el estado actual antes de decidir.'
        : followUpStatus === 'rejected' ? 'No se ha guardado el seguimiento. El asunto o tu acceso puede haber cambiado; consulta el estado actual.'
          : 'No hemos podido confirmar el estado actualizado. Consúltalo antes de decidir.'}
    </div> : <>
      {guidance ? <ConversationReturnGuidance key={`${account}:${threadId}:${guidance}:${brief.product?.sku}:${brief.product?.revision}:${guidance === 'preparation' ? open?.id ?? '' : brief.sourceFingerprint}`}
        brief={brief} account={account} threadId={threadId} mode={guidance}
        onRefresh={onRefresh} onRetryConflict={onRetryConflict} onOpenAmazon={openPreview} onDefer={id => onFollowUp('defer', id)}
        followUpBusy={followUpStatus === 'busy'} refreshing={refreshing} /> : <>
      {open && <p className="conversation-followup-pending"><strong>Pendiente por atender</strong>{open.label}</p>}
      {completed && <p className="conversation-followup-pending"><strong>Seguimiento listo para cerrar</strong>
        El asunto que aplazaste ya no figura pendiente en la ficha.
        <span className="conversation-followup-state-note">Recordatorio anterior: {completed.label}</span>
      </p>}
      {amazonStatus && <p><strong>Estado de Amazon:</strong> {amazonStatus}</p>}
      <p className="conversation-followup-next"><strong>Siguiente paso:</strong> {nextStep(brief)}</p>
      {followUpStatus === 'retry' && <p role="status">No hemos podido comprobar si se guardó el seguimiento. Pulsa de nuevo la misma acción para comprobarlo.</p>}
      </>}
      {guidance && followUpStatus === 'retry' && <p role="status">No hemos podido comprobar si se guardó el seguimiento. Pulsa de nuevo la misma acción para comprobarlo.</p>}
    </>}
    {(needsRefresh || !guidance) && <div className="conversation-followup-actions">{needsRefresh
      ? <button type="button" disabled={followUpStatus === 'refresh'} onClick={onRefresh}>
        {followUpStatus === 'refresh' ? 'Actualizando resumen…' : 'Actualizar resumen →'}
      </button>
      : <><button type="button" onClick={reviewAmazon ? openPreview : continueChat}>
        {reviewAmazon ? 'Revisar borrador para Amazon →' : 'Continuar en esta conversación →'}
      </button>
        {open && <button className="conversation-followup-secondary" type="button" disabled={followUpStatus === 'busy'}
          onClick={() => onFollowUp('defer', open.id)}>{followUpStatus === 'busy' ? 'Guardando…' : 'Aplazar por ahora'}</button>}
        {completed && <button className="conversation-followup-secondary" type="button" disabled={followUpStatus === 'busy'}
          onClick={() => onFollowUp('resolve', completed.id)}>{followUpStatus === 'busy' ? 'Guardando…' : 'Cerrar seguimiento'}</button>}
      </>}
    </div>}
    {localDrafts.map(item => <div key={`${item.scope.revision}:${item.scope.sectionId}`}
      className="conversation-followup-notice conversation-followup-detail" role="status">
      <strong>Copia de edición anterior · revisión {item.scope.revision}</strong>
      <p>La ficha o el paso cambió. Conservamos esta copia local para copiarla y compararla; no se aplicará a la revisión {product.revision}.</p>
      <textarea aria-label={`Copiar edición local de la revisión ${item.scope.revision}`} readOnly rows={3}
        value={Object.entries(item.answers).map(([field, value]) => `${field}: ${value}`).join('\n\n')} />
    </div>)}
  </section>;
}

function SnapshotCard({ snapshot, product, onContinue, onPrepare, preparing, loading, readFailed, error }: {
  snapshot: AmazonSnapshot | null; product: NonNullable<ReturnBrief['product']>;
  onContinue: () => void; onPrepare: () => void; preparing: boolean; loading: boolean; readFailed: boolean; error: string;
}) {
  const preview = snapshot?.preview;
  const current = !!preview?.sourceCurrent && snapshot?.productRevision === product.revision;
  const media = preview?.mediaReadiness === 'missing' ? 'Falta la imagen principal.'
    : preview?.mediaReadiness === 'invalid' ? 'Hay una imagen con dirección no válida.'
      : 'Las imágenes aún no están verificadas.';
  return <section className="conversation-followup-card" aria-label={`Vista previa para Amazon de ${product.name}`}>
    <span className="conversation-followup-tag">BORRADOR LOCAL · SIN ENVIAR</span>
    <h2>Vista previa para Amazon</h2>
    <p><strong>Producto:</strong> {product.name}</p>
    {preview ? <>
      {preview.title && <p><strong>Título guardado:</strong> {preview.title}</p>}
      <p><strong>Revisión:</strong> {current ? 'Actual para esta ficha.' : 'La ficha o los requisitos han cambiado; prepara una vista nueva.'}</p>
      <p><strong>Comprobación local:</strong> {preview.localValidation === 'valid' ? 'Sin errores de atributos detectados.' : `${preview.localIssues.length} incidencia(s) que revisar.`} {media}</p>
      <p className="conversation-followup-next">No consta un intento de envío de este borrador desde Uonify. La publicación solo se solicitará después de verificar medios y requisitos y aprobar un envío concreto.</p>
    </> : <p>{loading ? 'Consultando la vista previa guardada…' : readFailed
      ? 'No podemos comprobar si la vista previa guardada sigue vigente.'
      : 'Aún no hay una vista previa guardada para esta ficha. Puedes prepararla aquí sin enviar nada a Amazon.'}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="conversation-followup-actions">
      {loading ? null : readFailed
        ? <button type="button" onClick={onContinue}>Continuar en esta conversación →</button>
        : !snapshot || !current
        ? <button type="button" disabled={preparing} onClick={onPrepare}>{preparing ? 'Preparando vista previa…' : 'Preparar vista previa local'}</button>
        : <button type="button" onClick={onContinue}>Continuar en esta conversación →</button>}
    </div>
  </section>;
}

export function ConversationFollowUpCards({ account, threadId, suspended, shouldFollowScroll = alwaysFollowScroll }: Props) {
  useEffect(() => {
    window.addEventListener('uonify:identity-changed', clearAllReturnPreparationDrafts);
    return () => window.removeEventListener('uonify:identity-changed', clearAllReturnPreparationDrafts);
  }, []);
  const container = useRef<HTMLDivElement>(null);
  const refreshSequence = useRef(0);
  const [view, setView] = useState<'return' | 'amazon'>('return');
  const [visible, setVisible] = useState(!suspended);
  const [assignmentFocusConflict, setAssignmentFocusConflict] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [refreshingSources, setRefreshingSources] = useState(false);
  const [actionError, setActionError] = useState('');
  const followUpIntent = useRef<ReturnFollowUpIntent | null>(null);
  const followUpInFlight = useRef<ReturnFollowUpIntent | null>(null);
  const [followUpState, setFollowUpState] = useState<{ account: string; threadId: string; status: FollowUpStatus } | null>(null);
  const [retryIssue, setRetryIssue] = useState<{ account: string; threadId: string } | null>(null);
  const historyAccount = useWorkspaceStore(state => state.historyAccount);
  const historyRevision = useWorkspaceStore(state => state.historyRevision);
  const activeThreadId = useWorkspaceStore(state => state.activeThreadId);
  const currentThread = useWorkspaceStore(state => state.threads.find(item => item.id === threadId));
  const pendingLiveBind = useWorkspaceStore(state => state.pendingLiveThreadIds.includes(threadId)
    && !state.boundLiveThreadIds.includes(threadId)
    && !state.threads.find(thread => thread.id === threadId)?.messages.length);
  const owned = useOwnedRequest(account, currentAccountEmail);
  const client = useQueryClient();
  useEffect(() => {
    const conflict = (event: Event) => {
      const detail = (event as CustomEvent<{ account?: string; threadId?: string }>).detail;
      if (detail?.account !== account || detail.threadId !== threadId || currentAccountEmail() !== account) return;
      setAssignmentFocusConflict(true);
      setVisible(true);
      void client.invalidateQueries({ queryKey: ['uony-assignment-return', account, threadId] });
    };
    window.addEventListener('uonify:assignment-focus-conflict', conflict);
    return () => window.removeEventListener('uonify:assignment-focus-conflict', conflict);
  }, [account, threadId, client]);
  useEffect(() => {
    const created = (event: Event) => {
      const detail = (event as CustomEvent<{ account?: string; threadId?: string }>).detail;
      if (detail?.account !== account || detail.threadId !== threadId || currentAccountEmail() !== account) return;
      setVisible(true);
      void client.invalidateQueries({ queryKey: ['uony-assignment-return', account, threadId] });
    };
    window.addEventListener('uonify:assignment-created', created);
    window.addEventListener('uonify:assignment-work-changed', created);
    return () => {
      window.removeEventListener('uonify:assignment-created', created);
      window.removeEventListener('uonify:assignment-work-changed', created);
    };
  }, [account, threadId, client]);
  const enabled = !USE_MOCKS && historyAccount === account && account === currentAccountEmail()
    && activeThreadId === threadId && visible && !suspended && !pendingLiveBind;
  const assignmentReturn = useQuery({ queryKey: ['uony-assignment-return', account, threadId, historyRevision],
    queryFn: ({ signal }) => owned.read(next => getAssignmentReturn(threadId, next), signal),
    enabled, retry: false, refetchOnWindowFocus: true, refetchOnReconnect: true,
    // Solo hay sondeo mientras consta un trabajo activo. Un fallo detiene el ciclo hasta reconexión o reconsulta.
    refetchInterval: query => !query.state.error && query.state.data?.assignments.some(item => item.assignmentWork?.currentRevision
      && ['queued', 'running'].includes(item.assignmentWork.status))
      ? 15000 + [...`${account}:${threadId}`].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5000 : false });
  const brief = useQuery({ queryKey: ['uony-return-brief', account, threadId, historyRevision],
    queryFn: ({ signal }) => owned.read(next => getReturnBrief(threadId, next), signal),
    enabled, retry: false, refetchOnWindowFocus: true, refetchOnReconnect: true });
  const assignmentVisible = !!assignmentReturn.data && showAssignmentReturn(assignmentReturn.data, currentThread?.messages ?? []);
  const assignmentRequested = assignmentFocusConflict || requestsAssignmentReturn(currentThread?.messages ?? []);
  useEffect(() => {
    if (!enabled || !brief.data) return;
    const intents = returnRetryIntents(account, threadId);
    if (!intents.length) return;
    const controller = new AbortController();
    for (const intent of intents) void reconcileReturnRetryIntent(intent, controller.signal)
      .then(confirmed => {
        if (confirmed && !controller.signal.aborted && currentAccountEmail() === account
          && useWorkspaceStore.getState().activeThreadId === threadId) {
          void client.invalidateQueries({ queryKey: ['uony-return-brief', account, threadId] });
        }
      }).catch(() => { /* Sin recibo verificable conservamos el mismo UUID. */ });
    return () => controller.abort();
  }, [account, threadId, enabled, brief.data, client]);
  const product = brief.data?.product;
  const snapshotKey = ['amazon-publish-snapshot', account, product?.sku, product?.revision];
  const snapshot = useQuery({ queryKey: snapshotKey,
    queryFn: ({ signal }) => owned.read(next => getLatestAmazonSnapshot(product!.sku, next), signal),
    enabled: enabled && view === 'amazon' && !!product, retry: false, refetchOnWindowFocus: true, refetchOnReconnect: true });
  const followUpStatus = followUpState?.account === account && followUpState.threadId === threadId ? followUpState.status : null;
  const retryConflict = retryIssue?.account === account && retryIssue.threadId === threadId
    || hasReturnRetryConflict(account, threadId);
  const setStatus = (status: FollowUpStatus) => setFollowUpState({ account, threadId, status });
  useEffect(() => {
    if (followUpStatus !== 'retry' || !brief.data) return;
    const intent = followUpIntent.current;
    if (!intent || intent.account !== account || intent.threadId !== threadId) return;
    const targetStillAvailable = intent.action === 'defer'
      ? brief.data.pending.some(item => item.id === intent.pendingId && item.followUp === 'open')
      : brief.data.completedFollowUps.some(item => item.id === intent.pendingId && item.canResolve);
    if (brief.data.trackingVersion !== intent.expectedVersion
      || brief.data.sourceFingerprint !== intent.sourceFingerprint
      || brief.data.product?.revision !== intent.productRevision || !targetStillAvailable) {
      followUpIntent.current = null;
      setFollowUpState({ account, threadId, status: null });
    }
  }, [account, threadId, brief.data, followUpStatus]);
  const refreshBrief = async () => {
    if (!owned.current() || followUpStatus === 'refresh') return;
    setStatus('refresh');
    const result = await brief.refetch();
    if (!owned.current() || useWorkspaceStore.getState().activeThreadId !== threadId) return;
    if (result.isSuccess) { setRetryIssue(null); clearReturnRetryConflict(account, threadId); }
    setStatus(result.isSuccess ? null : 'refresh_failed');
  };
  const manageFollowUp = async (action: ReturnFollowUpAction, pendingId: string) => {
    if (!brief.data || !owned.current() || useWorkspaceStore.getState().activeThreadId !== threadId
      || (followUpInFlight.current?.account === account && followUpInFlight.current.threadId === threadId)
      || ['conflict', 'refresh', 'refresh_failed', 'rejected'].includes(followUpStatus ?? '')) return;
    let intent = followUpIntent.current;
    try {
      // Reenviar el mismo UUID si la respuesta anterior fue incierta evita duplicar la decisión.
      if (!intent || intent.account !== account || intent.threadId !== threadId
        || intent.action !== action || intent.pendingId !== pendingId) {
        intent = createReturnFollowUpIntent(account, threadId, brief.data, action, pendingId);
        followUpIntent.current = intent;
      }
    } catch {
      followUpIntent.current = null;
      setStatus('rejected');
      return;
    }
    try {
      const requestIntent = intent;
      followUpInFlight.current = intent;
      setStatus('busy');
      const result = await owned.read(signal => postReturnFollowUp(requestIntent, signal));
      if (!owned.current() || useWorkspaceStore.getState().activeThreadId !== threadId) return;
      followUpIntent.current = null;
      if (result.kind === 'conflict') { setStatus('conflict'); return; }
      setStatus('refresh');
      const refreshed = await brief.refetch();
      if (!owned.current() || useWorkspaceStore.getState().activeThreadId !== threadId) return;
      setStatus(refreshed.isSuccess ? null : 'refresh_failed');
    } catch (failure) {
      if (owned.current() && useWorkspaceStore.getState().activeThreadId === threadId) {
        const definitive = failure instanceof ApiError && failure.status >= 400 && failure.status < 500
          && failure.status !== 408 && failure.status !== 429;
        if (definitive) followUpIntent.current = null;
        setStatus(definitive ? 'rejected' : 'retry');
      }
    } finally { if (followUpInFlight.current === intent) followUpInFlight.current = null; }
  };
  useEffect(() => {
    const refresh = (event: Event) => {
      if (account !== currentAccountEmail()) return;
      const changes = (event as CustomEvent<ProductChange[]>).detail;
      if (Array.isArray(changes) && product?.sku
        && !changes.some(change => change.product.sku === product.sku || change.previousSku === product.sku)) return;
      const sequence = ++refreshSequence.current;
      setRefreshingSources(true);
      void Promise.all([
        client.invalidateQueries({ queryKey: ['uony-return-brief', account, threadId] }),
        client.invalidateQueries({ queryKey: ['uony-assignment-return', account, threadId] }),
        client.invalidateQueries({ queryKey: ['amazon-publish-snapshot', account, product?.sku] }),
      ]).finally(() => { if (sequence === refreshSequence.current) setRefreshingSources(false); });
    };
    window.addEventListener('uonify:products-changed', refresh);
    return () => { refreshSequence.current += 1; window.removeEventListener('uonify:products-changed', refresh); };
  }, [account, client, threadId, product?.sku]);
  useEffect(() => useUiStore.subscribe((state, previous) => {
    if (state.pendingReply?.threadId === threadId
      && !(state.pendingReply.requestId && isReturnRetryRequest(account, threadId, state.pendingReply.requestId))) setVisible(false);
    else if (previous.pendingReply?.threadId === threadId
      && requestsAssignmentReturn(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages ?? [])) setVisible(true);
  }), [account, threadId]);
  useLayoutEffect(() => {
    if ((!product && !(assignmentVisible && assignmentReturn.data?.assignments.length)) || !shouldFollowScroll()) return;
    const list = container.current?.parentElement;
    if (list?.classList.contains('conversation-messages')) list.scrollTop = list.scrollHeight;
  }, [product, assignmentReturn.data, assignmentVisible, view, snapshot.data, shouldFollowScroll]);
  const continueChat = () => {
    setAssignmentFocusConflict(false);
    setVisible(!!(assignmentFocusConflict && product));
    focusComposer();
  };
  const assignmentFocus = useAssignmentFocusSelection(account, threadId, assignmentReturn.data, continueChat);
  const refreshAssignments = async () => {
    if (!owned.current() || useWorkspaceStore.getState().activeThreadId !== threadId) return;
    const result = await assignmentReturn.refetch();
    if (result.isSuccess && owned.current() && useWorkspaceStore.getState().activeThreadId === threadId)
      assignmentFocus.clearConflict();
  };
  if (!enabled) return null;
  // Un GET antiguo o fallido no afirma que no existan encargos; conserva el resumen de ficha ya comprobado.
  // La ficha conserva su tarjeta aprobada, salvo al recuperar un conflicto de foco explícito.
  // Esa excepción usa el mismo espacio de Conversación y desaparece al confirmar el encargo.
  if ((!product || assignmentFocusConflict) && !brief.isPending && !assignmentReturn.isPending && !assignmentReturn.isError && !refreshingSources
    && (assignmentVisible || assignmentFocusConflict) && assignmentReturn.data?.assignments.length) return <div ref={container} className="conversation-followup-wrap">
    <ConversationAssignmentReturn view={assignmentReturn.data} onSelect={id => void assignmentFocus.choose(id)}
      onRefresh={() => void refreshAssignments()} busy={assignmentFocus.busy} lockedId={assignmentFocus.lockedId}
      uncertain={assignmentFocus.uncertain} conflict={assignmentFocus.conflict} notice={assignmentFocus.notice} />
  </div>;
  if (assignmentRequested && (!product || assignmentFocusConflict) && !brief.isPending && (assignmentReturn.isError
    || assignmentFocusConflict && !assignmentReturn.isPending && !assignmentReturn.data?.assignments.length)) return <div ref={container} className="conversation-followup-wrap">
    <section className="conversation-followup-card" aria-label="Consulta de encargos">
      <h2>No podemos consultar tus encargos</h2>
      <p>Tu conversación sigue disponible. Vuelve a consultar el estado guardado cuando quieras.</p>
      <div className="conversation-followup-actions"><button type="button" onClick={() => void assignmentReturn.refetch()}>
        Volver a consultar →
      </button></div>
    </section>
  </div>;
  if (assignmentFocusConflict) return null;
  if (refreshingSources || !product || !brief.data) return null;
  if (view === 'return' || publicationMode(brief.data) !== 'local') return <div ref={container} className="conversation-followup-wrap">
    <ReturnCard brief={brief.data} account={account} threadId={threadId} openPreview={() => setView('amazon')} continueChat={continueChat} followUpStatus={followUpStatus}
      onFollowUp={(action, pendingId) => void manageFollowUp(action, pendingId)} onRefresh={() => void refreshBrief()}
      onRetryConflict={() => setRetryIssue({ account, threadId })} retryConflict={retryConflict}
      refreshing={refreshingSources || brief.isFetching || brief.isError} />
  </div>;
  const loading = snapshot.isFetching || snapshot.isPending;
  const latest = loading || snapshot.isError ? null : snapshot.data ?? null;
  const missing = snapshot.error instanceof ApiError && snapshot.error.status === 404;
  const readFailed = !loading && snapshot.isError && !missing;
  const readError = readFailed ? errorMessage(snapshot.error, 'No se ha podido consultar la vista previa guardada.') : '';
  const prepare = async () => {
    if (preparing || !owned.current()) return;
    setPreparing(true); setActionError('');
    try {
      await owned.read(signal => prepareAmazonSnapshot(product.sku, product.revision, signal));
      if (!owned.current() || useWorkspaceStore.getState().activeThreadId !== threadId) return;
      await client.invalidateQueries({ queryKey: snapshotKey, exact: true });
    } catch (failure) {
      if (owned.current()) setActionError(errorMessage(failure, 'No se ha podido preparar la vista previa local.'));
    } finally { if (owned.current()) setPreparing(false); }
  };
  return <div ref={container} className="conversation-followup-wrap"><SnapshotCard snapshot={latest} product={product} onContinue={continueChat}
    onPrepare={() => void prepare()} preparing={preparing} loading={loading} readFailed={readFailed} error={actionError || readError} /></div>;
}
