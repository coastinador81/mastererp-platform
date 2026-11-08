import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { currentAccountEmail } from '@/modules/auth';
import { getAmazonRequirements } from '@/modules/catalog';
import { useOwnedRequest } from '@/shared/hooks';
import { queryClient } from '@/shared/api/queryClient';
import { errorMessage } from '@/shared/api/client';
import { Icon, InformationDisclosure } from '@/shared/ui';
import { customerText } from '@/shared/lib/customerText';
import { formResponse, type ConversationFormData } from '../model/conversationForm';
import { prepareProductRequirements, sendLivePrompt, startMaterialReview } from '../hooks/liveConversation';
import { activeThreadOf, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { useUiStore } from '../hooks/uiStore';
import { focusComposer } from '../hooks/actions';
import { conversationFormDraftKey, readConversationFormDraft, writeConversationFormDraft, type ConversationFormDraft } from '../hooks/conversationFormDrafts';
import { ConversationQuestion } from './ConversationQuestion';
import { ConversationRequirementsProgress } from './ConversationRequirementsProgress';
import { requirementsFormIsCurrent } from '../model/requirementsFormFreshness';
import '../styles/conversation-form.css';
import '../styles/question-panel.css';

interface Props { form: ConversationFormData; account: string; threadId: string; messageIndex: number; active: boolean; autoOpen?: boolean; questionTarget?: HTMLElement | null; questionEnabled?: boolean }

/** Cada pregunta conserva su respuesta; solo el envío final continúa el hilo. */
export function ConversationForm({ form, account, threadId, messageIndex, active, autoOpen = false, questionTarget = null, questionEnabled = true }: Props) {
  const id = useId();
  const draftKey = conversationFormDraftKey(account, threadId, form.id);
  const [draft, setDraft] = useState<ConversationFormDraft>(() => {
    const saved = readConversationFormDraft(draftKey);
    const reviewOpensOnDelivery = autoOpen && (form.context?.kind === 'product_incident' || Boolean(form.review));
    return saved ? { ...saved, open: reviewOpensOnDelivery } : {
      values: Object.fromEntries(form.fields.map(field => [field.id, field.value ?? ''])),
      customFieldIds: form.fields.filter(field => field.type === 'select' && field.value && !field.options?.includes(field.value) && !field.closed).map(field => field.id),
      step: 0, open: reviewOpensOnDelivery,
    };
  });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [openingTarget, setOpeningTarget] = useState<HTMLElement | null>(null);
  const openingScope = useRef({ target: null as HTMLElement | null, version: 0 });
  const [focusRequested, requestFocus] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const reopening = useRef(false);
  const owned = useOwnedRequest(account, currentAccountEmail);
  const pendingReply = useUiStore(state => state.pendingReply);
  const pending = !!pendingReply;
  const answeringHere = pendingReply?.threadId === threadId && pendingReply.requirements?.formId === form.id;
  const submitting = sending || answeringHere;
  const selectedThreadId = useWorkspaceStore(state => state.activeThreadId);
  const sameContext = account === currentAccountEmail() && selectedThreadId === threadId;
  const step = Math.min(draft.step, form.fields.length - 1);
  const field = form.fields[step];
  const isLast = step === form.fields.length - 1;
  const busy = sending || checking || pending;
  const canDeferRequirements = form.context?.kind === 'product_guide' && form.context.section === 'amazon_requirements' && form.context.step === 'fields';
  const legacyMaterialReview = form.context?.kind === 'drive_analysis';
  const compactQuestion = !legacyMaterialReview && form.context?.kind !== 'product_incident';
  const compactPanel = compactQuestion && form.fields.length === 1 && !form.notice && !field.resourceEvidence && !field.suggestion;
  const requirements = form.context?.kind === 'product_guide' && form.context.section === 'amazon_requirements';
  const refreshBeforeOpen = requirements && form.context?.kind === 'product_guide' && form.context.step === 'fields';
  const visible = (draft.open || answeringHere) && sameContext && (active || submitting) && questionEnabled && questionTarget !== null
    && (!refreshBeforeOpen || openingTarget === questionTarget || answeringHere);
  useLayoutEffect(() => {
    if (autoOpen) useWorkspaceStore.getState().consumeFormOpening(threadId, messageIndex, form.id);
    if (!refreshBeforeOpen) return;
    const eligible = sameContext && (active || submitting) && questionEnabled;
    const target = eligible ? questionTarget : null;
    if (openingScope.current.target !== target) {
      openingScope.current = { target, version: openingScope.current.version + 1 };
      setOpeningTarget(null);
    }
  }, [refreshBeforeOpen, autoOpen, threadId, messageIndex, form.id, sameContext, active, submitting, questionEnabled, questionTarget]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (account === currentAccountEmail()) writeConversationFormDraft(draftKey, draft);
  }, [account, draftKey, draft]);

  const change = (value: string, custom = false) => {
    if (!sameContext || account !== currentAccountEmail() || busy) return;
    setDraft(before => ({ ...before, values: { ...before.values, [field.id]: value },
      customFieldIds: custom ? [...new Set([...before.customFieldIds, field.id])] : before.customFieldIds.filter(item => item !== field.id),
    }));
    setError('');
  };
  const close = () => {
    if (inFlight.current || answeringHere) return;
    setDraft(before => ({ ...before, open: false }));
    setOpeningTarget(null);
    requestFocus(false);
    if (sameContext && account === currentAccountEmail()) focusComposer();
  };
  const reopenRequirements = async () => {
    if (reopening.current || busy || form.context?.kind !== 'product_guide') return;
    const sku = form.context.sku;
    const openingVersion = openingScope.current.version;
    const stillHere = () => {
      const thread = activeThreadOf(useWorkspaceStore.getState());
      return owned.current() && thread?.id === threadId && thread.messages.length - 1 === messageIndex
        && thread.messages[messageIndex]?.conversationForm?.id === form.id && questionTarget !== null
        && openingScope.current.target === questionTarget && openingScope.current.version === openingVersion;
    };
    if (!stillHere()) return;
    reopening.current = true; setChecking(true); setError('');
    try {
      const result = await queryClient.fetchQuery({ queryKey: ['uony-form-reentry', account, threadId, form.id],
        queryFn: ({ signal }) => owned.read(next => getAmazonRequirements(sku, next), signal), staleTime: 0, gcTime: 0, retry: false });
      if (!stillHere() || useUiStore.getState().pendingReply) return;
      if (requirementsFormIsCurrent(form, result)) {
        setOpeningTarget(questionTarget); setDraft(before => ({ ...before, open: true })); requestFocus(true);
        return;
      }
      setSending(true);
      const accepted = prepareProductRequirements(sku, { onSettled: (success, reason) => {
        if (!mounted.current || !owned.current()) return;
        setSending(false);
        if (!success) setError(reason || 'No hemos podido actualizar las preguntas. Tu borrador se conserva.');
      } });
      if (!accepted) { setSending(false); setError('Espera a que Uony termine y vuelve a intentarlo.'); }
    } catch (reason) {
      if (stillHere()) setError(errorMessage(reason, 'No hemos podido comprobar las preguntas. Tu borrador se conserva; vuelve a intentarlo.'));
    } finally {
      reopening.current = false;
      if (mounted.current) setChecking(false);
    }
  };
  const fieldError = (index: number) => {
    const item = form.fields[index];
    if (!item.required && !draft.values[item.id]?.trim()) return undefined;
    return formResponse({ ...form, fields: [item] }, draft.values, new Set(draft.customFieldIds)).error;
  };
  const sendAnswers = (text: string, answers: Record<string, string>) => {
    if (busy || !sameContext || account !== currentAccountEmail() || !active) return;
    const thread = activeThreadOf(useWorkspaceStore.getState());
    if (inFlight.current || thread?.id !== threadId || thread.messages.length - 1 !== messageIndex
      || thread.messages[messageIndex]?.conversationForm?.id !== form.id) return;
    inFlight.current = true; setError(''); setSending(true);
    const accepted = sendLivePrompt(text, { preserveDraft: true,
      ...(form.context ? { formResponse: { formId: form.id, answers } } : {}), onSettled: (success, reason) => {
      if (!mounted.current) return;
      inFlight.current = false; setSending(false);
      if (success) {
        setDraft(before => ({ ...before, open: false }));
        if (account === currentAccountEmail() && useWorkspaceStore.getState().activeThreadId === threadId) focusComposer();
      } else setError(reason || 'No se han enviado tus respuestas. Inténtalo de nuevo.');
    } });
    if (!accepted) {
      inFlight.current = false; setSending(false);
      setError(useComposerStore.getState().status || 'Espera a que Uony termine y vuelve a intentarlo.');
    }
  };
  const sendInlineChoice = (option: string) => {
    if (busy || inFlight.current || !active || !sameContext || account !== currentAccountEmail()) return;
    const thread = activeThreadOf(useWorkspaceStore.getState());
    if (thread?.id !== threadId || thread.messages.length - 1 !== messageIndex
      || thread.messages[messageIndex]?.conversationForm?.id !== form.id) return;
    inFlight.current = true; setSending(true); setError('');
    setDraft(before => ({ ...before, values: { ...before.values, [field.id]: option } }));
    const accepted = sendLivePrompt(option, { preserveDraft: true, onSettled: (success, reason) => {
      if (!mounted.current) return;
      inFlight.current = false; setSending(false);
      if (success) setDraft(before => ({ ...before, open: false }));
      else setError(reason || 'No se ha enviado tu respuesta. Inténtalo de nuevo.');
    } });
    if (!accepted) {
      inFlight.current = false; setSending(false);
      setError(useComposerStore.getState().status || 'Espera a que Uony termine y vuelve a intentarlo.');
    }
  };
  const advance = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !sameContext || account !== currentAccountEmail() || !active) return;
    const invalid = fieldError(step);
    if (invalid) { setError(invalid); return; }
    if (form.presentation === 'inline_choice') { sendInlineChoice(draft.values[field.id]?.trim() ?? ''); return; }
    if (!isLast) { setDraft(before => ({ ...before, step: step + 1 })); requestFocus(true); setError(''); return; }
    const response = formResponse(form, draft.values, new Set(draft.customFieldIds));
    if (response.error) {
      setError(response.error);
      const invalidIndex = form.fields.findIndex((_, index) => Boolean(fieldError(index)));
      if (invalidIndex >= 0) { setDraft(before => ({ ...before, step: invalidIndex })); requestFocus(true); }
      return;
    }
    sendAnswers(response.text!, draft.values);
  };

  if (requirements && form.context?.kind === 'product_guide' && form.context.step === 'reasoning') {
    return <ConversationRequirementsProgress form={form} account={account} threadId={threadId} active={active} questionTarget={questionTarget} />;
  }
  if (legacyMaterialReview) return <section className="conversation-question-card" aria-label="Continuar con Amazon">
    <header><Icon name="uony" size={20} /><strong>Continuar con los requisitos de Amazon</strong></header>
    <p>Uony utilizará tus documentos y solo te preguntará por los datos que falten para Amazon.</p>
    {active && <button type="button" className="question-open" disabled={busy || !sameContext} onClick={() => {
      if (form.context?.kind !== 'drive_analysis' || !sameContext || account !== currentAccountEmail()) return;
      if (!startMaterialReview(form.context.sku, form.context.analysisId)) setError('Espera a que Uony termine y vuelve a intentarlo.');
    }}>Continuar con Uony</button>}
    {error && <p role="alert">{error}</p>}
  </section>;

  return <>{!visible && <section className={compactQuestion ? 'uony-question-invitation' : 'conversation-question-card'} aria-label={`Preguntas: ${form.title}`}>
    {!compactQuestion && <><header><Icon name="uony" size={20} /><strong>{form.title}</strong></header>
      <p>{sending ? 'Uony está revisando tus respuestas.' : active ? `${form.fields.length} ${form.fields.length === 1 ? 'pregunta para continuar' : 'preguntas para continuar'}.` : 'Preguntas de esta conversación.'}</p></>}
    {active && <button type="button" className="question-open" aria-expanded={visible} aria-controls={`${id}-panel`}
      disabled={busy || !sameContext || !questionEnabled || !questionTarget} onClick={() => {
      if (!sameContext || account !== currentAccountEmail() || busy) return;
      if (requirements && form.context?.kind === 'product_guide' && form.context.step === 'fields') {
        void reopenRequirements();
        return;
      }
      setDraft(before => ({ ...before, open: true }));
      requestFocus(true);
    }}>{checking ? 'Comprobando pregunta…' : compactQuestion ? 'Responder pregunta' : Object.values(draft.values).some(value => value.trim()) ? 'Continuar respuesta' : 'Responder a Uony'}</button>}
    {active && requirements && form.context?.kind === 'product_guide' && form.context.step === 'fields' && <details><summary>Ver mi borrador anterior</summary><dl>{form.fields.map(item => <div key={item.id}><dt>{item.label}</dt><dd>{draft.values[item.id] || 'Sin responder'}</dd></div>)}</dl></details>}
    {error && <p role="alert">{error}</p>}
    {!active && !sending && <details><summary>Ver preguntas y borrador</summary><dl>{form.fields.map(item => <div key={item.id}>
      <dt>{item.label}</dt><dd>{draft.values[item.id] || 'Consulta la respuesta en la conversación.'}</dd>
    </div>)}</dl></details>}
    </section>}
    {visible && questionTarget && createPortal(<section id={`${id}-panel`} className={`uony-question-panel${compactPanel ? ' is-compact' : ''}`} aria-label={`Pregunta de Uony: ${form.title}`} onKeyDown={event => { if (event.key === 'Escape' && !submitting) close(); }}>
      <header className="uony-question-header"><span><Icon name="uony" size={17} />Pregunta de Uony</span>
        {form.fields.length > 1 && <span className="uony-question-counter" aria-live="polite" aria-label={`Pregunta ${step + 1} de ${form.fields.length}`}>{step + 1} de {form.fields.length}</span>}
        <button type="button" aria-label="Cerrar preguntas" title="Cerrar y continuar después" disabled={submitting} onClick={close}><Icon name="x" size={16} /></button>
      </header>
      <form id={`${id}-question`} className="uony-question-form" onSubmit={advance} noValidate aria-busy={submitting}>
        <div className="uony-question-body">
        {form.notice && (form.context?.kind === 'product_incident'
          ? <p className="uony-question-hint">{customerText(form.notice)}</p>
          : <InformationDisclosure><p>{customerText(form.notice)}</p></InformationDisclosure>)}
        {form.review && <section className="uony-incident-review" aria-label="Revisión de la corrección para Amazon"><p>Se enviarán estos cambios al confirmar la opción de envío.</p>
          <dl>{form.review.map((row, index) => <div key={`${row.label}-${index}`}><dt>{row.label}</dt><dd><span>Actual</span>{row.before}</dd><dd><span>Propuesto</span>{row.after}</dd></div>)}</dl>
        </section>}
        <ConversationQuestion key={field.id} field={field} value={draft.values[field.id] ?? ''} custom={draft.customFieldIds.includes(field.id)} disabled={busy}
          compact={compactPanel} allowCustom={!(form.context?.kind === 'product_guide' && form.context.section === 'choice' && field.id === 'mode')}
          change={change} focusRequested={focusRequested} onFocusHandled={() => requestFocus(false)} />
        {error && <p role="alert" className="uony-question-error">{error}</p>}
        {submitting && <p role="status" className="uony-question-wait">Enviando tus respuestas…</p>}
        </div>
        <footer className="uony-question-actions">
          {!compactPanel && <span className="uony-question-footnote">Tus respuestas se conservan al cerrar.</span>}
          <div>
            {step > 0 && <button type="button" disabled={busy} onClick={() => { setDraft(before => ({ ...before, step: step - 1 })); requestFocus(true); setError(''); }}>Anterior</button>}
            {canDeferRequirements && <button type="button" disabled={busy} onClick={() => sendAnswers('Completaré estos requisitos de Amazon más tarde; continuar con la preparación.', { requirements_action: 'later' })}>Completar más tarde</button>}
            <button type="submit" className="uony-question-next" disabled={busy}>{submitting ? 'Enviando…' : isLast ? form.submitLabel ?? 'Enviar respuestas' : 'Siguiente'}<Icon name={compactPanel ? 'arrow-right' : isLast ? 'uony' : 'arrow-right'} size={17} /></button>
          </div>
        </footer>
      </form>
    </section>, questionTarget)}
  </>;
}
