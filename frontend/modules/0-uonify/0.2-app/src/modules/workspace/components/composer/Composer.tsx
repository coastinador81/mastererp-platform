import { ProjectContext } from '../navigation/Projects';
import { USE_MOCKS } from '@/shared/api/config';
import { useEffect, useId, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { toggleNavDrawer } from '../../hooks/actions';
import { useComposerStore, visibleComposerStatus } from '../../hooks/composerStore';
import { sendPrompt } from '../../hooks/conversation';
import { useRegisterRef, useUiStore, workspaceRefs } from '../../hooks/uiStore';
import { useSpeech } from '../../hooks/useSpeech';
import { toggleMicrophone, toggleSpeaker } from '../../hooks/voiceSession';
import { VoiceAudioControls } from '@/shared/ui';
import { requirePrompt } from '../authBridge';
import { SendIcon, ThreadsIcon } from '../ShellIcons';
import { VoiceTalkButton } from '../VoiceWelcome';
import { AiPicker } from './AiPicker';
import { GoogleAiPicker } from './GoogleAiPicker';
import { Attachments, MoreButton, MoreMenu } from './MoreMenu';
import { UsagePanel, UsageTrigger } from './Usage';
import { ContextUsage } from './ContextUsage';
import { submitPendingFirstIntent } from '../../hooks/initialIntent';
import { acknowledgePendingPrompt } from '@/modules/auth';
import { activeThreadOf, useWorkspaceStore } from '../../hooks/workspaceStore';
import { useLiveTranscriptPreview } from '../../hooks/liveTranscriptPreview';
import { activeConversationStatusOf, isTransientConversationStatus } from '../../hooks/activeConversationStatus';
import { canSendWrittenFollowup, useWrittenFollowups } from '../../hooks/writtenFollowup';

// Última petición de foco atendida (el compositor puede volver a montarse en otro sitio).
let handledFocusTick = 0;

/**
 * Compositor del espacio (plantilla #view-espacio y composer-tools.js): texto,
 * «+», Hilos, uso … modo rápido, modelo, esfuerzo, dictado, voz y enviar, en una
 * sola fila. Enter envía; Mayúsculas+Enter añade una línea.
 */
export function Composer() {
  const draftText = useComposerStore(state => state.draft);
  const globalStatus = useComposerStore(state => state.status);
  const statusThreadId = useComposerStore(state => state.statusThreadId);
  const threadStatuses = useComposerStore(state => state.threadStatuses);
  const listening = useComposerStore(state => state.listening);
  const microphoneMuted = useComposerStore(state => state.microphoneMuted);
  const speakerMuted = useComposerStore(state => state.speakerMuted);
  const focusTick = useComposerStore(state => state.focusTick);
  const model = useComposerStore(state => state.model);
  const effort = useComposerStore(state => state.effort);
  const speed = useComposerStore(state => state.speed);
  const pending = useUiStore(state => state.pendingReply);
  const waiting = pending !== null;
  const followups = useWrittenFollowups(state => state.pending);
  const thread = useWorkspaceStore(activeThreadOf);
  const account = useWorkspaceStore(state => state.historyAccount);
  const epoch = useWorkspaceStore(state => state.historyEpoch);
  const sendBlocked = followups.some(item => item.account === account && item.epoch === epoch)
    || (waiting && (USE_MOCKS || !canSendWrittenFollowup()));
  const userPreview = useLiveTranscriptPreview(state => {
    const activeTurn = state.pendingUsers.findLast(item => !item.ended && item.threadId === thread?.id
      && item.account === account && item.epoch === epoch);
    return activeTurn ? state.previews.find(item => item.role === 'user' && item.turnId === activeTurn.turnId
      && item.threadId === thread?.id && item.account === account && item.epoch === epoch)
      : state.previews.findLast(item => item.role === 'user'
        && item.threadId === thread?.id && item.account === account && item.epoch === epoch);
  });
  const voiceTurnEnded = useLiveTranscriptPreview(state => state.pendingUsers.some(item => item.ended
    && item.threadId === thread?.id && item.account === account && item.epoch === epoch
    && item.turnId === userPreview?.turnId));
  const spokenText = listening === 'talk' && !voiceTurnEnded ? userPreview?.text ?? '' : '';
  const shownText = spokenText ? [draftText, spokenText].filter(Boolean).join('\n') : draftText;
  const status = visibleComposerStatus({ status: globalStatus, statusThreadId, threadStatuses }, thread?.id ?? null);
  const activeStatus = activeConversationStatusOf(thread, pending, status);
  const navOpen = useUiStore(state => state.navOpen);
  const form = useRef<HTMLFormElement>(null);
  const draft = useRef<HTMLTextAreaElement>(null);
  const usageTrigger = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const id = useId().replace(/:/g, '');
  const usagePanelId = `composer-usage-panel-${id}`;
  const moreMenuId = `composer-more-menu-${id}`;
  const listen = useSpeech(form, draft);
  useRegisterRef('composer', form);
  useRegisterRef('draft', draft);

  // El texto crece con lo escrito, hasta 120 px.
  useLayoutEffect(() => {
    const element = draft.current;
    if (!element) return;
    element.style.height = 'auto';
    if (shownText) element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
    if (spokenText) element.scrollTop = element.scrollHeight;
  }, [shownText, spokenText]);

  // Al montarse en otro sitio conserva el foco si lo tenía (en el PROTO se movía el
  // mismo nodo); si otro compositor ya está montado, el foco pasa a él enseguida.
  useLayoutEffect(() => {
    const element = draft.current;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (element && useComposerStore.getState().hadFocus && lost) element.focus({ preventScroll: true });
    useComposerStore.setState({ hadFocus: false });
    const formElement = form.current;
    return () => {
      if (!formElement?.contains(document.activeElement)) return;
      const other = workspaceRefs.draft;
      if (other && other !== element && other.isConnected) other.focus({ preventScroll: true });
      else useComposerStore.setState({ hadFocus: true });
    };
  }, []);
  useEffect(() => {
    if (focusTick <= handledFocusTick) return;
    handledFocusTick = focusTick;
    draft.current?.focus({ preventScroll: true });
  }, [focusTick]);

  // Escape cierra primero un menú abierto del compositor y devuelve el foco a su botón.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const state = useComposerStore.getState();
      if (state.usageOpen) {
        state.setUsageOpen(false);
        usageTrigger.current?.focus();
      } else if (state.picker) {
        const trigger = form.current?.querySelector<HTMLElement>('[data-composer-ai-trigger]')
          ?? form.current?.querySelector<HTMLElement>(state.picker === 'model' ? '[data-composer-model-trigger]' : '[data-composer-effort-trigger]');
        state.setPicker(null);
        trigger?.focus();
      }
      if (state.moreOpen) {
        state.setMoreOpen(false);
        moreButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const state = useComposerStore.getState();
    // La transcripción provisional no es un borrador ni una orden para la ruta de texto.
    if (useLiveTranscriptPreview.getState().previews.some(item => item.role === 'user'
      && item.threadId === thread?.id && item.account === account && item.epoch === epoch)) return;
    // Los adjuntos se quedan en el navegador hasta que exista su subida.
    if (state.attachments.length) {
      state.setStatus('No se pueden enviar estos archivos. Quítalos para enviar solo el texto.');
      return;
    }
    const text = state.draft.trim();
    // Solo con la sesión lista; si falta, auth abre el acceso o el alta y guarda la petición.
    if (text) void requirePrompt(text, () => {
      if (USE_MOCKS || !submitPendingFirstIntent(text)) {
        const accepted = sendPrompt(text);
        if (!USE_MOCKS && accepted) acknowledgePendingPrompt(text);
      }
    });
    else draft.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    form.current?.requestSubmit();
  };

  return (
    <form
      ref={form}
      className={`composer${waiting ? ' is-waiting' : ''}`}
      id="composer"
      autoComplete="off"
      data-ai-model={model}
      data-ai-effort={effort}
      data-ai-speed={speed}
      onSubmit={submit}
    >
      <ProjectContext />
      <label className="sr-only" htmlFor="composer-text">Escribe a Uony</label>
      <textarea
        ref={draft}
        id="composer-text"
        rows={1}
        maxLength={3000}
        placeholder="¿Qué quieres hacer posible hoy?"
        value={shownText}
        readOnly={!!spokenText}
        onChange={event => { if (!spokenText) useComposerStore.getState().setDraft(event.target.value); }}
        onKeyDown={onKeyDown}
      />
      <Attachments />
      <div className="composer-bottom">
        <MoreButton buttonRef={moreButton} menuId={moreMenuId} />
        <div className="composer-navigation">
          <button className="composer-nav-button" id="composer-threads" type="button" aria-label="Hilos" aria-controls="nav-drawer" aria-expanded={navOpen} data-tooltip="Hilos" onClick={event => toggleNavDrawer(event.currentTarget)}>
            <ThreadsIcon />
          </button>
          {USE_MOCKS && <UsageTrigger triggerRef={usageTrigger} panelId={usagePanelId} />}
        </div>
        <div className="composer-bottom-actions">
          {!USE_MOCKS && <ContextUsage formRef={form} />}
          {USE_MOCKS ? <AiPicker form={form} /> : <GoogleAiPicker form={form} />}
          <VoiceAudioControls talking={listening === 'talk'} dictating={listening === 'dictate'} microphoneMuted={microphoneMuted} speakerMuted={speakerMuted} dictate={() => listen('dictate')} toggleMicrophone={toggleMicrophone} toggleSpeaker={toggleSpeaker} />
          <VoiceTalkButton active={listening === 'talk'} listen={() => listen('talk')} />
          <button className="composer-send" type="submit" aria-label="Enviar mensaje" aria-disabled={sendBlocked || !!spokenText || undefined} data-tooltip={sendBlocked ? 'Uony está respondiendo…' : spokenText ? 'Espera a terminar de hablar' : 'Enviar'} data-tooltip-align="end">
            <SendIcon />
          </button>
        </div>
      </div>
      <p className="composer-live-status" data-composer-status="" role="status" aria-live="polite"
        hidden={!status || !!activeStatus?.consumesComposerStatus
          || (isTransientConversationStatus(status) && (!thread || !pending || pending.threadId !== thread.id))}>{status}</p>
      {USE_MOCKS && <UsagePanel formRef={form} triggerRef={usageTrigger} panelId={usagePanelId} />}
      <MoreMenu formRef={form} draftRef={draft} buttonRef={moreButton} menuId={moreMenuId} />
    </form>
  );
}
