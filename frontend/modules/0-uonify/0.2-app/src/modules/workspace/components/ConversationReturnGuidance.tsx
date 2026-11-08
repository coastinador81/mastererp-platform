import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { getAmazonRequirements, getProductPreparation, preparationKey, updateProductPreparation,
  type AmazonRequirements, type PreparationField, type PreparationSection, type ProductPreparation } from '@/modules/catalog';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useOwnedRequest } from '@/shared/hooks';
import { hasProductEdits, notifyProductChanges } from '@/shared/pim';
import { getReturnBrief, type ReturnBrief } from '../api/conversationCards';
import { clearReturnPreparationDraft, readReturnPreparationDraft, rememberReturnPreparationDraft } from '../api/returnPreparationDraft';
import { clearReturnRetryIntent, markReturnRetryConflict, readReturnRetryIntent,
  releaseReturnRetryRequest, retainReturnRetryRequest,
  sameReturnRetry, saveReturnRetryIntent,
  type ReturnRetryIdentity } from '../api/returnRetryIntent';
import { prepareProductRequirements } from '../hooks/liveConversation';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { ConversationConnection } from './ConversationConnection';

// El backend valida hilo, vínculo, revisión, trabajo y huella antes de cualquier efecto.
const RETURN_RETRY_CAS_READY = true;

export type ReturnGuidanceMode = 'completed' | 'reasoning_error' | 'reasoning_unknown' | 'preparation';

export function returnGuidanceMode(brief: ReturnBrief): ReturnGuidanceMode | null {
  const open = brief.pending.find(item => item.followUp === 'open');
  if (open?.kind === 'reasoning' && brief.status?.reasoning === 'error') return 'reasoning_error';
  if (open?.kind === 'reasoning' && brief.status?.reasoning === 'unknown') return 'reasoning_unknown';
  if (open?.kind === 'preparation') return 'preparation';
  const publication = brief.status?.amazonPublication;
  const localPublication = !publication || publication === 'not_started' || publication === 'local_draft';
  const amazonFields = brief.pending.length === 1 && open?.id === 'amazon_requirements:fields';
  if ((!open || amazonFields) && !brief.completedFollowUps.length && localPublication
    && !brief.status?.amazonPublicationDetail?.attemptId && brief.status?.reasoning === 'completed') return 'completed';
  return null;
}

interface Props {
  brief: ReturnBrief;
  account: string;
  threadId: string;
  mode: ReturnGuidanceMode;
  onRefresh: () => void;
  onRetryConflict: () => void;
  onOpenAmazon: () => void;
  onDefer: (id: string) => void;
  followUpBusy: boolean;
  refreshing: boolean;
}

function savedSection(data: ProductPreparation | undefined, sectionId: string):
  { section: PreparationSection; fields: PreparationField[]; first: PreparationField } | null {
  const section = data?.preparation.sections.find(item => item.id === sectionId);
  const first = section?.fields.find(item => item.value.trim());
  return section && first && section.state === 'saved' ? { section, fields: section.fields, first } : null;
}

function sameBrief(before: ReturnBrief, after: ReturnBrief): boolean {
  return !!before.product && !!after.product && before.product.sku === after.product.sku
    && before.product.revision === after.product.revision
    && before.sourceFingerprint === after.sourceFingerprint;
}

export function ConversationReturnGuidance({ brief, account, threadId, mode, onRefresh, onRetryConflict, onOpenAmazon,
  onDefer, followUpBusy, refreshing }: Props) {
  const product = brief.product!;
  const detailId = useId();
  const factsId = useId();
  const connectionId = useId();
  const owned = useOwnedRequest(account, currentAccountEmail);
  const client = useQueryClient();
  const active = () => owned.current() && useWorkspaceStore.getState().historyAccount === account
    && useWorkspaceStore.getState().activeThreadId === threadId;
  const open = brief.pending.find(item => item.followUp === 'open');
  const sectionId = mode === 'preparation' ? open?.id.split(':')[1] ?? '' : '';
  const draftScope = { account, threadId, sku: product.sku, revision: product.revision, sectionId };
  const preparation = useQuery({ queryKey: ['uony-return-preparation', account, threadId, product.sku, product.revision],
    queryFn: ({ signal }) => owned.read(next => getProductPreparation(product.sku, next), signal),
    enabled: mode === 'preparation' && active(), retry: false, refetchOnMount: 'always', refetchOnWindowFocus: false });
  const currentPreparation = preparation.data?.product.revision === product.revision ? preparation.data : undefined;
  const saved = savedSection(currentPreparation, sectionId);
  const [expanded, setExpanded] = useState(false);
  const [checkedBrief, setCheckedBrief] = useState<ReturnBrief | null>(null);
  const [checkedReasoning, setCheckedReasoning] = useState<AmazonRequirements | null>(null);
  const [showFacts, setShowFacts] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() => readReturnPreparationDraft(draftScope) ?? {});
  const [acknowledged, setAcknowledged] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const inspect = async () => {
    if (!active() || working || refreshing) return;
    setWorking(true); setNotice(''); setConflict(false);
    try {
      if (mode === 'completed') {
        const current = await owned.read(signal => getReturnBrief(threadId, signal));
        if (!active()) return;
        if (!sameBrief(brief, current) || returnGuidanceMode(current) !== 'completed') { setConflict(true); return; }
        if (open?.id === 'amazon_requirements:fields') {
          const requirements = await owned.read(signal => getAmazonRequirements(product.sku, signal));
          if (!active()) return;
          if (requirements.product.revision !== product.revision || requirements.evaluation.state !== 'needs_input') {
            setConflict(true); return;
          }
          setCheckedReasoning(requirements);
        }
        setCheckedBrief(current);
      } else if (mode === 'preparation') {
        const refreshed = await preparation.refetch();
        if (!active()) return;
        const latest = refreshed.isSuccess ? savedSection(refreshed.data, sectionId) : null;
        if (!refreshed.isSuccess || refreshed.data.product.revision !== product.revision
          || !latest) { setConflict(true); return; }
        if (!expanded) setDraft(readReturnPreparationDraft(draftScope)
          ?? Object.fromEntries(latest.fields.map(field => [field.id, field.value])));
      } else {
        const current = await owned.read(signal => getReturnBrief(threadId, signal));
        if (!active()) return;
        const reasoning = current.status?.reasoningDetail;
        const expected = mode === 'reasoning_error' ? 'error' : 'unknown';
        if (!sameBrief(brief, current) || current.status?.reasoning !== expected
          || reasoning?.id !== open?.id.split(':')[1] || reasoning?.status !== expected
          || reasoning.revision !== product.revision) { setConflict(true); return; }
        setCheckedBrief(current);
      }
      setExpanded(true);
    } catch (reason) {
      if (active()) setNotice(errorMessage(reason, 'No hemos podido consultar el estado guardado. Vuelve a consultarlo.'));
    } finally { if (active()) setWorking(false); }
  };

  const save = async () => {
    if (!active() || working || refreshing || !expanded || !saved || !currentPreparation || conflict) return;
    if (hasProductEdits(currentPreparation.product)) {
      setNotice('Guarda primero los cambios abiertos en Producto. Este texto se conserva aquí.'); return;
    }
    const task = owned.begin();
    if (!task) return;
    setWorking(true); setNotice('');
    try {
      const updated = await updateProductPreparation(product.sku, { revision: product.revision,
        section: saved.section.id, answers: draft, reviewed: true }, task.signal);
      // El servidor confirmó el guardado: libera la copia aunque el usuario cambiara de hilo entretanto.
      clearReturnPreparationDraft(draftScope);
      task.check();
      if (!active()) return;
      client.setQueryData(preparationKey(account, product.sku), updated);
      notifyProductChanges([{ product: updated.product, previousSku: product.sku }]);
      await client.invalidateQueries({ queryKey: ['uony-return-brief', account, threadId] });
      if (active()) setNotice('Dato revisado y guardado en la misma ficha.');
    } catch (reason) {
      if (task.valid() && active()) {
        if (reason instanceof ApiError && reason.status === 409) setConflict(true);
        setNotice(errorMessage(reason, 'No se ha guardado el dato. Tu texto sigue aquí.'));
      }
    } finally { task.finish(); if (active()) setWorking(false); }
  };

  const retry = () => {
    const current = checkedBrief;
    const detail = current?.status?.reasoningDetail;
    const acknowledgementRequired = !!detail?.requiresConsumptionAcknowledgement;
    if (!RETURN_RETRY_CAS_READY || !active() || working || refreshing || conflict || !current || !detail
      || detail.canRetry === false || !current.sourceFingerprint || product.linkVersion === undefined
      || (acknowledgementRequired && !acknowledged)) return;
    const identity: ReturnRetryIdentity = { account, threadId, sku: product.sku, revision: product.revision,
      linkVersion: product.linkVersion, reasoningId: detail.id, reasoningStatus: detail.status === 'unknown' ? 'unknown' : 'error',
      sourceFingerprint: current.sourceFingerprint };
    const thread = useWorkspaceStore.getState().threads.find(item => item.id === threadId);
    const intent = saveReturnRetryIntent(identity, thread?.projectId ?? null, acknowledgementRequired && acknowledged);
    if (intent && acknowledgementRequired && !intent.acknowledgeUnknown) {
      setConflict(true); setNotice('La posibilidad de consumo cambió. Consulta el estado antes de iniciar otro intento.'); return;
    }
    if (!intent) { setConflict(true); setNotice('Hay un intento anterior sin conciliar o no podemos conservar su identificador. Consulta el estado antes de iniciar otro.'); return; }
    retainReturnRetryRequest(intent);
    setWorking(true); setNotice('');
    const accepted = prepareProductRequirements(product.sku, { retry: true,
      acknowledgeUnknown: intent.acknowledgeUnknown, expectedRevision: intent.revision,
      expectedLinkVersion: intent.linkVersion, expectedReasoningId: intent.reasoningId,
      expectedReasoningStatus: intent.reasoningStatus, expectedSourceFingerprint: intent.sourceFingerprint,
      requestId: intent.requestId, expectedThreadId: intent.threadId, expectedProjectId: intent.projectId,
      onSettled: (success, reason, outcome) => {
        if (success || outcome === 'conflict' || outcome === 'definitive') clearReturnRetryIntent(intent);
        if (outcome === 'conflict' || outcome === 'definitive') markReturnRetryConflict(account, threadId);
        // sendLivePrompt limpia pendingReply en finally, tras llamar onSettled.
        window.setTimeout(() => releaseReturnRetryRequest(intent), 0);
        if (active()) {
          setWorking(false);
          if (outcome === 'conflict' || outcome === 'definitive') { setConflict(true); onRetryConflict(); }
          if (!success) setNotice(outcome === 'uncertain'
            ? 'No podemos confirmar si llegó a iniciarse. Conservamos esta misma solicitud; consulta su estado antes de volver a pulsar.'
            : reason || 'No se ha podido comprobar la revisión. La misma solicitud sigue guardada.');
        }
      },
    });
    if (!accepted) { releaseReturnRetryRequest(intent); setWorking(false);
      setNotice('No se ha iniciado otra revisión. Conservamos la misma solicitud para consultarla después.'); }
  };

  const unsavedPreparation = mode === 'preparation' && expanded && !!saved
    && saved.fields.some(field => (draft[field.id] ?? '') !== field.value);
  const editField = (id: string, value: string) => {
    const next = { ...draft, [id]: value };
    if (saved?.fields.some(field => (next[field.id] ?? '') !== field.value)) {
      if (!rememberReturnPreparationDraft(draftScope, next)) setNotice(
        'No podemos conservar una copia al recargar. Guarda este apartado antes de salir o copia tu texto.');
      else if (notice.startsWith('No podemos conservar una copia')) setNotice('');
    } else clearReturnPreparationDraft(draftScope);
    setDraft(next);
  };
  const defer = open && <button type="button" className="conversation-followup-secondary"
    disabled={followUpBusy || refreshing || unsavedPreparation}
    onClick={() => onDefer(open.id)}>{followUpBusy ? 'Guardando…' : 'Aplazar por ahora'}</button>;
  if (mode === 'preparation') {
    const stale = !!preparation.data && !currentPreparation;
    const value = saved?.first.value.trim() ?? '';
    const extra = saved ? saved.fields.filter(field => field.id !== saved.first.id && field.value.trim()).length : 0;
    return <>
      <p className="conversation-followup-pending"><strong>Dato guardado por revisar</strong>{saved
        ? `«${saved.first.label}», en ${saved.section.label}: «${value.slice(0, 160)}${value.length > 160 ? '…' : ''}». ${extra ? `Hay ${extra} dato(s) más en este apartado. ` : ''}El texto está guardado, pero aún no está revisado.`
        : preparation.isPending ? 'Consultando el dato guardado…' : 'El dato ha cambiado; actualiza el resumen antes de revisarlo.'}</p>
      <p className="conversation-followup-next"><strong>Siguiente paso:</strong> {saved
        ? 'Revisar este dato con Uony en la conversación.' : 'Comprobar la versión actual de la ficha.'}</p>
      <div className="conversation-followup-actions">{saved && !stale
        ? <button type="button" disabled={working || refreshing} aria-expanded={expanded}
          aria-controls={expanded ? detailId : undefined} onClick={() => void inspect()}>{working || refreshing ? 'Consultando…' : 'Revisar este dato →'}</button>
        : <button type="button" onClick={preparation.isError ? () => void preparation.refetch() : onRefresh}>Actualizar resumen →</button>}{defer}</div>
      {expanded && saved && <div id={detailId} className="conversation-followup-detail">
        <p>Revisa los datos ya guardados en {saved.section.label}. Puedes corregirlos antes de marcar el apartado como revisado.</p>
        {saved.fields.map(field => <div key={field.id} className="conversation-followup-field">
          <label htmlFor={`uony-return-${field.id}`}><strong>{field.label}{field.required ? ' · obligatorio' : ''}</strong></label>
          {field.type === 'select' && field.options?.includes(draft[field.id] ?? '')
            ? <select id={`uony-return-${field.id}`} value={draft[field.id] ?? ''}
              onChange={event => editField(field.id, event.target.value)}>
              {field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
            : field.type === 'textarea'
              ? <textarea id={`uony-return-${field.id}`} value={draft[field.id] ?? ''}
                onChange={event => editField(field.id, event.target.value)} maxLength={3000} rows={3} />
              : <input id={`uony-return-${field.id}`} value={draft[field.id] ?? ''}
                onChange={event => editField(field.id, event.target.value)} maxLength={3000} />}
        </div>)}
        <div className="conversation-followup-actions"><button type="button" disabled={working || refreshing || conflict}
          onClick={() => void save()}>{working ? 'Guardando…' : 'Guardar y marcar revisado'}</button></div>
      </div>}
      {unsavedPreparation && <p role="status">Guarda tus cambios antes de aplazar este dato.</p>}
      {(conflict || stale) && <p role="alert">La ficha cambió. Conservamos tu texto; actualiza el resumen antes de guardarlo.</p>}
      {notice && <p role="alert">{notice}</p>}
    </>;
  }
  if (mode === 'completed') {
    const amazon = checkedBrief?.status?.amazonRequirements;
    const fields = checkedReasoning?.evaluation.fields ?? [];
    return <>
      <p className="conversation-followup-pending"><strong>Trabajo terminado</strong>La revisión de IA terminó para esta versión de la ficha. Los datos confirmados siguen guardados.</p>
      <p className="conversation-followup-next"><strong>Siguiente paso:</strong> Ver el resultado guardado y elegir cómo continuar con la ficha.</p>
      <div className="conversation-followup-actions"><button type="button" disabled={working || refreshing}
        aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
        onClick={() => void inspect()}>{working || refreshing ? 'Consultando…' : 'Ver resultado y continuar →'}</button></div>
      {expanded && checkedBrief && <div id={detailId} className="conversation-followup-detail"><p><strong>Revisión guardada:</strong> Se completó para esta versión de {product.name}.</p>
        <p>{amazon === 'not_started' ? 'Aún no hay requisitos de Amazon consultados para esta ficha.'
          : amazon === 'locally_valid_not_published' ? 'Los requisitos guardados están comprobados localmente; no consta una publicación por esta revisión.'
            : amazon === 'needs_input' ? `Hay ${fields.length} dato(s) de Amazon que necesitan revisión en esta ficha.`
              : 'Consulta la ficha para decidir el siguiente trabajo.'}</p>
        {amazon === 'needs_input' && <ul>{fields.map(field => <li key={field.id}><strong>{field.label}:</strong> {field.value?.trim()
          ? `«${field.value.trim()}» · revisar` : 'falta este dato'}</li>)}</ul>}
        <p className="conversation-followup-state-note">Abrir este resumen no inicia otra revisión.</p>
        <div className="conversation-followup-actions"><button type="button" aria-expanded={showFacts}
          aria-controls={showFacts ? factsId : undefined} onClick={() => setShowFacts(value => !value)}>Ver datos de la ficha</button>
          {amazon === 'locally_valid_not_published'
            && <button type="button" onClick={onOpenAmazon}>Revisar borrador para Amazon →</button>}</div>
        {amazon === 'not_started' && <p>Cuando quieras preparar la ficha de Amazon, puedes pedírselo a Uony en esta conversación.</p>}
        {showFacts && <div id={factsId} className="conversation-followup-detail"><p><strong>Datos confirmados en la ficha:</strong></p>
          <ul>{checkedBrief.confirmedFacts.map(fact => <li key={fact.id}>{fact.label}: {fact.value}</li>)}</ul></div>}
      </div>}
      {conflict && <p role="alert">El trabajo guardado cambió. Actualiza el resumen antes de continuar.</p>}
      {notice && <p role="alert">{notice}</p>}
    </>;
  }
  const unknown = mode === 'reasoning_unknown';
  const reasoning = checkedBrief?.status?.reasoningDetail;
  const retryIdentity: ReturnRetryIdentity | null = checkedBrief?.sourceFingerprint && reasoning
    && product.linkVersion !== undefined ? { account, threadId, sku: product.sku,
      revision: product.revision, linkVersion: product.linkVersion, reasoningId: reasoning.id,
      reasoningStatus: unknown ? 'unknown' : 'error', sourceFingerprint: checkedBrief.sourceFingerprint } : null;
  const previousRetry = readReturnRetryIntent({ account, threadId, sku: product.sku });
  const acknowledgementRequired = !!reasoning?.requiresConsumptionAcknowledgement;
  const staleRetry = !!previousRetry && (!retryIdentity || !sameReturnRetry(retryIdentity, previousRetry)
    || (acknowledgementRequired && !previousRetry.acknowledgeUnknown));
  return <>
    <p className="conversation-followup-pending"><strong>{unknown ? 'Resultado de IA incierto' : 'La revisión de IA falló'}</strong>{unknown
      ? 'La conexión se interrumpió y no podemos confirmar si la comprobación terminó o consumió crédito. Tu ficha sigue guardada.'
      : 'El intento guardado terminó con error. Tu ficha y sus datos confirmados siguen guardados. Consulta la incidencia antes de decidir si reintentas.'}</p>
    <p className="conversation-followup-next"><strong>Siguiente paso:</strong> {unknown
      ? 'Consultar el estado guardado antes de decidir si se hace otra prueba.'
      : 'Revisar la incidencia guardada, sin iniciar otra prueba.'}</p>
    <div className="conversation-followup-actions"><button type="button" disabled={working || refreshing}
      aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
      onClick={() => void inspect()}>{working || refreshing ? 'Consultando…' : unknown
      ? 'Consultar estado de IA →' : 'Ver incidencia de IA →'}</button>{defer}</div>
    {expanded && reasoning && <div id={detailId} className="conversation-followup-detail"><p><strong>Estado guardado:</strong> {reasoning.message}</p>
      <p className="conversation-followup-state-note">{unknown
        ? 'No iniciamos otra operación automáticamente. Repetirla puede consumir crédito adicional de Google.'
        : 'Un nuevo intento puede consumir crédito de Google y solo empieza si lo decides.'}</p>
      <p className="conversation-followup-state-note">Antes de repetir una prueba de IA debemos confirmar el estado de la anterior y la revisión actual de la ficha.</p>
      {staleRetry && <p role="alert">Hay un intento anterior por conciliar. Actualiza el resumen antes de iniciar otro.</p>}
      {RETURN_RETRY_CAS_READY && reasoning.canRetry && retryIdentity && !staleRetry && acknowledgementRequired &&
        <label className="conversation-followup-consent"><input type="checkbox" checked={acknowledged}
          onChange={event => setAcknowledged(event.target.checked)} />Entiendo que repetir la revisión puede generar consumo adicional de IA.</label>}
      <div className="conversation-followup-actions"><button type="button" disabled={working || refreshing} onClick={() => void inspect()}>
        {working || refreshing ? 'Consultando…' : 'Actualizar estado guardado'}</button>
        {(reasoning.connectionRequired || reasoning.previousConnectionFailure) && <button type="button" aria-expanded={showConnection}
          aria-controls={showConnection ? connectionId : undefined} onClick={() => setShowConnection(value => !value)}>
          {showConnection ? 'Ocultar permisos de Google' : reasoning.connectionRequired
            ? 'Revisar conexión Google' : 'Revisar permisos de Google'}</button>}
        {RETURN_RETRY_CAS_READY && reasoning.canRetry && retryIdentity && !staleRetry && <button type="button"
          disabled={working || refreshing || (acknowledgementRequired && !acknowledged)} onClick={retry}>{working || refreshing ? 'Consultando…' : previousRetry
            ? 'Consultar la misma solicitud con Uony' : unknown ? 'Autorizar otro intento con Uony' : 'Reintentar con Uony'}</button>}
        <button type="button" className="conversation-followup-secondary" onClick={() => setExpanded(false)}>Volver al resumen</button></div>
      {showConnection && (reasoning.connectionRequired || reasoning.previousConnectionFailure) && <div id={connectionId}>
        <p>La última comprobación detectó un problema de permisos. Revisa Google Cloud y Drive aunque aparezcan conectados.</p>
        <ConversationConnection provider="cloud" account={account} />
        <ConversationConnection provider="drive" account={account} />
        <p>Después de reconectar, pídele a Uony que vuelva a revisar esta ficha.</p>
      </div>}
    </div>}
    {conflict && <p role="alert">La comprobación guardada cambió. Actualiza el resumen antes de continuar.</p>}
    {notice && <p role="alert">{notice}</p>}
  </>;
}
