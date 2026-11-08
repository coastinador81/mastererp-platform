import { clearLiveTransientProgress, endLiveSpeechProgress, interruptLiveSpeechProgress, observeLiveProgress, observeLiveProgressTurn } from './liveWorkProgress';
import { onAssistantReply } from '../model/events';
import { currentAccountEmail } from '@/modules/auth';
import { api } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { voiceInput } from '../model/voiceCommands';
import { sendPrompt } from './conversation';
import { useComposerStore, type ListeningMode } from './composerStore';
import { useWorkspaceStore } from './workspaceStore';
import { startLiveVoiceAudio, type LiveVoiceAudio } from './liveVoiceAudio';
import { useLiveTranscriptPreview } from './liveTranscriptPreview';
import { applyVoiceSubtitleEvent, useVoiceSubtitles } from './voiceSubtitles';
import { playVoiceChime } from './voiceChime';
import { observeLiveHandoff } from './liveHandoff';
import { createLiveVoiceStatus } from './liveVoiceStatus';
import { createLiveSemanticFailure } from './liveSemanticFailure';
import { cancelSpeech, isSpeaking, speakReply } from './voiceReplySpeaker';
import type { ServiceStatus } from './serviceStatus';
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { results: { length: number; [index: number]: { isFinal?: boolean; [index: number]: { transcript?: string } } } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; abort(): void;
}
type Constructor = new () => Recognition;
let current: Recognition | null = null;
let mode: ListeningMode = null;
let holding = false;
let stopReply: (() => void) | undefined;
let generation = 0;
let waitingReply = false;
let live: LiveVoiceAudio | null = null;
let pendingLiveThreadId: string | null = null;
let checkingVoiceAvailability = false;
const LIVE_START_FAILURE = 'No se pudo iniciar la voz en directo. Tu borrador escrito se conserva.';
const LIVE_LIMIT = 'El cupo de pruebas de voz en directo está agotado. No se iniciará otra automáticamente. Tu borrador escrito se conserva.';
const LIVE_START_LIMIT = 'No se pudo iniciar la voz en directo. El cupo de pruebas está agotado; revisaremos el fallo antes de otro intento. Tu borrador escrito se conserva.';
const composer = () => useComposerStore.getState();
function abortRecognition(): void {
  const old = current; current = null;
  if (old) { old.onend = null; old.onerror = null; old.onresult = null; old.abort(); }
}
export function toggleMicrophone(): void {
  if (mode !== 'talk') return;
  const muted = !composer().microphoneMuted;
  useComposerStore.setState({ microphoneMuted: muted });
  if (live) live.muteMicrophone(muted);
  else if (!checkingVoiceAvailability) { if (muted) abortRecognition(); else if (!waitingReply && !isSpeaking()) listen(); }
  composer().setStatus(muted ? 'Micrófono silenciado. La conversación sigue abierta.' : 'Micrófono activado.');
}
export function toggleSpeaker(): void {
  if (mode !== 'talk') return;
  const muted = !composer().speakerMuted;
  useComposerStore.setState({ speakerMuted: muted });
  if (!checkingVoiceAvailability) {
    if (muted) {
      if (live) live.muteSpeaker(true);
      else { cancelSpeech(); if (!waitingReply && !current && !composer().microphoneMuted) listen(); }
    } else if (live) live.muteSpeaker(false);
  }
  composer().setStatus(live && muted ? 'Altavoz silenciado. La conversación sigue guardándose en el chat.'
    : muted ? 'Altavoz silenciado. Puedes leer las respuestas en el chat.'
      : 'Altavoz activado para las próximas respuestas de Uony.');
}
/** Vive fuera del compositor: al pasar del inicio al chat no se corta la conversación. */
export function stopVoice(message = 'Micrófono detenido. Tu texto se conserva.', preserveHold = false): void {
  generation += 1;
  mode = null;
  checkingVoiceAvailability = false;
  if (!preserveHold) holding = false;
  stopReply?.(); stopReply = undefined;
  live?.stop(); live = null;
  useLiveTranscriptPreview.getState().clear();
  useVoiceSubtitles.getState().clear();
  clearLiveTransientProgress();
  // Un mensaje vacío es un reinicio interno silencioso; con texto hay una parada real que suena.
  if (message !== '') playVoiceChime('stop');
  if (pendingLiveThreadId) { useWorkspaceStore.getState().discardPendingLiveThread(pendingLiveThreadId); pendingLiveThreadId = null; }
  abortRecognition();
  cancelSpeech();
  waitingReply = false;
  useComposerStore.setState({ microphoneMuted: false, speakerMuted: false });
  composer().setListening(null);
  composer().setStatus(message);
}
function listen(): void {
  if (!mode || checkingVoiceAvailability || current || waitingReply || isSpeaking() || (mode === 'talk' && composer().microphoneMuted)) return;
  const scope = window as unknown as { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor };
  const Constructor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
  if (!Constructor) { stopVoice('La voz no está disponible en este navegador. Puedes escribir a Uony.'); return; }
  const token = generation;
  const recognizer = new Constructor();
  current = recognizer;
  recognizer.lang = 'es-ES'; recognizer.interimResults = true; recognizer.continuous = false;
  const before = composer().draft.trim();
  let heard = false;
  composer().setListening(mode);
  composer().setStatus(mode === 'dictate' ? 'Dictando… Tu voz se convierte en texto. Envíalo cuando termines.' : holding ? 'Te escucho. Di «listo» cuando hayas terminado; «para» detiene el micrófono.' : 'Te escucho. Puedes decir «espera a que diga listo» para hablar sin interrupciones.');
  recognizer.onresult = event => {
    if (token !== generation || current !== recognizer) return;
    const transcript = Array.from({ length: event.results.length }, (_, i) => event.results[i][0]?.transcript || '').join(' ').trim();
    composer().setDraft([before, transcript].filter(Boolean).join(' '));
    if (!event.results[event.results.length - 1]?.isFinal) return;
    heard = true;
    if (mode === 'dictate') { stopVoice('Texto añadido al mensaje. Revísalo antes de enviarlo.'); return; }
    const input = voiceInput(transcript, before, holding);
    holding = input.hold;
    composer().setDraft(input.text);
    if (input.action === 'stop') { stopVoice(); return; }
    if (input.action === 'wait') { composer().setStatus('Sigo escuchando hasta que digas «listo».'); return; }
    abortRecognition();
    waitingReply = true;
    if (!input.text || !sendPrompt(input.text)) { stopVoice('No se ha enviado el mensaje. Puedes revisarlo y volver a intentarlo.'); return; }
    composer().setStatus('Uony está respondiendo… Puedes detener la voz cuando quieras.');
  };
  recognizer.onend = () => {
    if (token !== generation || current !== recognizer) return;
    current = null;
    if (holding && heard) listen();
    else stopVoice(holding ? 'Se ha detenido la escucha. Tu texto sigue guardado; activa la voz para continuar.' : 'No he recibido una petición. Puedes volver a activar el micrófono.', holding);
  };
  recognizer.onerror = event => {
    if (token !== generation || event.error === 'aborted') return;
    stopVoice(event.error === 'not-allowed' ? 'Permite el micrófono en tu navegador para usar la voz.' : 'La escucha se ha interrumpido. Tu texto se conserva.', holding);
  };
  try { recognizer.start(); } catch { stopVoice('No se pudo iniciar el micrófono. Puedes escribir tu petición.'); }
}
function startClassicVoice(next: Exclude<ListeningMode, null>, preserveControls = false): void {
  const resumeHold = !mode && holding;
  const controls = preserveControls ? { microphoneMuted: composer().microphoneMuted, speakerMuted: composer().speakerMuted } : null;
  stopVoice('');
  holding = next === 'talk' && resumeHold;
  mode = next;
  if (controls) useComposerStore.setState(controls);
  composer().setListening(next);
  const token = generation;
  stopReply = onAssistantReply((text, options) => {
    if (mode !== 'talk' || token !== generation || holding && current) return;
    if (options?.threadId && options.threadId !== useWorkspaceStore.getState().activeThreadId) return;
    waitingReply = false;
    const reopen = () => {
      if (mode === 'talk' && token === generation) {
        if (composer().microphoneMuted) composer().setStatus('Micrófono silenciado. Actívalo para continuar hablando.');
        else listen();
      }
    };
    // No leer todo un informe: solo la respuesta breve y la siguiente pregunta.
    if (!speakReply({ spoken: options?.spoken || text, beforeSpeak: abortRecognition, onEnd: reopen,
      onError: () => stopVoice('La respuesta está escrita en el chat. Puedes activar la voz de nuevo.') })) reopen();
  });
  // Tono de cortesía al activar la voz, en el gesto del botón para que el navegador lo permita.
  playVoiceChime('start');
  listen();
}
export function toggleVoice(next: Exclude<ListeningMode, null>): void {
  if (mode === next) {
    stopVoice(live ? 'Voz detenida. Los mensajes confirmados siguen en el chat y tu borrador escrito se conserva.'
      : 'Micrófono detenido. Tu texto se conserva.');
    return;
  }
  if (next !== 'talk' || USE_MOCKS) { startClassicVoice(next); return; }
  const priorStartupFailure = composer().status.startsWith('No se pudo iniciar la voz en directo.');
  const account = currentAccountEmail();
  const initial = useWorkspaceStore.getState();
  if (!account || initial.historyAccount !== account) {
    stopVoice('La conversación aún se está preparando. Inténtalo de nuevo en un momento; tu borrador escrito se conserva.');
    return;
  }
  const sameConversation = () => {
    const current = useWorkspaceStore.getState();
    return current.historyAccount === account && current.historyEpoch === initial.historyEpoch
      && current.activeThreadId === initial.activeThreadId;
  };
  stopVoice('');
  mode = 'talk';
  checkingVoiceAvailability = true;
  const token = generation;
  composer().setListening('talk');
  composer().setStatus('Uony está preparando la conversación por voz…');
  void api.get<ServiceStatus>('/uony/services').then(status => {
    if (token !== generation || mode !== 'talk' || currentAccountEmail() !== account) return;
    if (!sameConversation()) {
      stopVoice('Voz detenida al cambiar de conversación.');
      return;
    }
    if (status?.accountEmail !== account) {
      stopVoice('No hemos podido verificar tu cuenta para la voz en directo.');
      return;
    }
    if (status.liveVoice === 'pilot_ready') startLiveVoicePilot();
    else if (status.liveVoice === 'not_integrated') startClassicVoice('talk', true);
    else if (status.liveVoice === 'pilot_exhausted') {
      stopVoice(priorStartupFailure ? LIVE_START_LIMIT : LIVE_LIMIT);
    }
    else stopVoice('No pudimos comprobar la voz en directo. Inténtalo de nuevo; tu borrador escrito se conserva.');
  }).catch(() => {
    if (token !== generation || mode !== 'talk' || currentAccountEmail() !== account) return;
    if (!sameConversation()) { stopVoice('Voz detenida al cambiar de conversación.'); return; }
    stopVoice('No pudimos comprobar la voz en directo. Inténtalo de nuevo; tu borrador escrito se conserva.');
  });
}
/** Entrada interna: el botón habitual solo llama tras verificar `pilot_ready` por cuenta. */
export function startLiveVoicePilot(): void {
  const controls = checkingVoiceAvailability
    ? { microphoneMuted: composer().microphoneMuted, speakerMuted: composer().speakerMuted } : null;
  stopVoice('');
  mode = 'talk';
  if (controls) useComposerStore.setState(controls);
  composer().setListening('talk');
  const token = generation;
  const account = currentAccountEmail();
  let initial = useWorkspaceStore.getState();
  if (!account || initial.historyAccount !== account) {
    stopVoice('La voz en directo necesita una sesión lista. Tu borrador escrito se conserva.');
    return;
  }
  if (!initial.activeThreadId) {
    pendingLiveThreadId = initial.createThread({ title: 'Conversación por voz', service: null,
      view: 'default', pendingLiveBind: true }).id;
    initial.setConversationExpanded(true);
    initial = useWorkspaceStore.getState();
  }
  const threadId = initial.activeThreadId;
  if (!threadId) { stopVoice('No se pudo preparar la conversación de voz.'); return; }
  const thread = initial.threads.find(item => item.id === threadId);
  if (!thread) { stopVoice('No se pudo verificar la conversación de voz.'); return; }
  // La respuesta del agente solo la dice la voz de Uony (narración verificada); nunca la síntesis
  // del navegador. Si esa voz no puede hablar, la respuesta queda escrita (decisión del dueño, 20-10-2026).
  const bufferedAssistant: Array<{ event: { turnId: string; text: string }; userTurnId: string }> = [];
  const orderedUserTurns: string[] = [];
  const interruptedReplies = new Set<string>();
  const assistantReplies = new Map<string, string | null>();
  const rememberUser = (turnId: string) => {
    if (!orderedUserTurns.includes(turnId)) {
      orderedUserTurns.push(turnId);
      observeLiveProgressTurn({ account, epoch: initial.historyEpoch, threadId }, turnId);
    }
  };
  const pendingUsers = () => useLiveTranscriptPreview.getState().pendingUsers.filter(item =>
    item.account === account && item.epoch === initial.historyEpoch && item.threadId === threadId);
  const nextAnchor = () => (useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages.length ?? 0)
    + pendingUsers().length + bufferedAssistant.length;
  const laterUserTurns = (turnId: string) => orderedUserTurns.slice(orderedUserTurns.indexOf(turnId) + 1);
  const rebasePending = (insertedIndex: number | null, turnId: string) => {
    if (insertedIndex !== null) useLiveTranscriptPreview.getState().rebase(threadId, insertedIndex, laterUserTurns(turnId));
  };
  const releaseAssistant = (userTurnId: string) => {
    const released = bufferedAssistant.filter(item => item.userTurnId === userTurnId);
    for (const item of released) {
      if (!interruptedReplies.has(item.event.turnId) && !handedOffTurns.has(userTurnId)) {
        rebasePending(useWorkspaceStore.getState().insertLiveAssistantMessage(threadId, { role: 'assistant',
          text: item.event.text, turnId: item.event.turnId, replyToTurnId: userTurnId,
          model: 'gemini-3.8-live' }, userTurnId), userTurnId);
      }
      useLiveTranscriptPreview.getState().remove(threadId, 'assistant', item.event.turnId);
    }
    for (const item of released) bufferedAssistant.splice(bufferedAssistant.indexOf(item), 1);
  };
  const endSpeech = (turn: { account: string; epoch: number; threadId: string; turnId: string; anchorIndex: number }) => {
    useLiveTranscriptPreview.getState().endUser(turn, () => {
      if (!valid()) return;
      const pending = pendingUsers().find(item => item.turnId === turn.turnId);
      if (!pending) return;
      const laterTurnIds = laterUserTurns(turn.turnId);
      for (const item of [...bufferedAssistant]) {
        if (item.userTurnId !== turn.turnId) continue;
        if (!interruptedReplies.has(item.event.turnId) && !handedOffTurns.has(turn.turnId)) {
          rebasePending(useWorkspaceStore.getState().insertLiveAssistantAfterPending(threadId, { role: 'assistant',
            text: item.event.text, turnId: item.event.turnId, replyToTurnId: turn.turnId,
            model: 'gemini-3.8-live' },
          pending.anchorIndex, laterTurnIds), turn.turnId);
        }
        useLiveTranscriptPreview.getState().remove(threadId, 'assistant', item.event.turnId);
        bufferedAssistant.splice(bufferedAssistant.indexOf(item), 1);
      }
      useWorkspaceStore.getState().retryHistory?.();
    });
  };
  const valid = () => mode === 'talk' && token === generation && currentAccountEmail() === account
    && useWorkspaceStore.getState().historyAccount === account
    && useWorkspaceStore.getState().historyEpoch === initial.historyEpoch
    && useWorkspaceStore.getState().activeThreadId === initial.activeThreadId;
  let liveReady = false;
  const handedOffTurns = new Set<string>(), failedTurns = new Map<string, { requestId: string; execution: 'not_started' | 'unknown' }>();
  const voiceStatus = createLiveVoiceStatus(text => composer().setStatus(text, threadId), () => orderedUserTurns.at(-1));
  const semanticFailure = createLiveSemanticFailure({ account, epoch: initial.historyEpoch, threadId },
    event => voiceStatus.semanticFailure(event.turnId, event.message, event.persistence));
  const suppressReplies = (turnId: string) => {
    handedOffTurns.add(turnId);
    useWorkspaceStore.getState().suppressLiveAssistantReplies(threadId, turnId);
    for (const item of [...bufferedAssistant]) if (item.userTurnId === turnId) {
      interruptedReplies.add(item.event.turnId);
      useLiveTranscriptPreview.getState().remove(threadId, 'assistant', item.event.turnId);
      bufferedAssistant.splice(bufferedAssistant.indexOf(item), 1);
    }
    for (const [replyTurnId, userTurnId] of assistantReplies) if (userTurnId === turnId) {
      interruptedReplies.add(replyTurnId);
      useLiveTranscriptPreview.getState().remove(threadId, 'assistant', replyTurnId);
    }
    for (const preview of useLiveTranscriptPreview.getState().previews) if (preview.threadId === threadId
      && preview.role === 'assistant' && preview.replyToTurnId === turnId)
      useLiveTranscriptPreview.getState().remove(threadId, 'assistant', preview.turnId);
  };
  const session = startLiveVoiceAudio({
    threadId,
    projectId: thread.projectId ?? null,
    valid,
    bound: () => {
      if (!valid()) return;
      useWorkspaceStore.getState().markLiveThreadBound(threadId);
      if (pendingLiveThreadId === threadId) pendingLiveThreadId = null;
      useWorkspaceStore.getState().retryHistory?.();
    },
    status: state => {
      if (!valid()) return;
      if (state !== 'connecting') liveReady = true;
      composer().setListening('talk');
      voiceStatus.status(state);
    },
    captionStatus: state => {
      if (!valid()) return;
      voiceStatus.caption(state);
    },
    // PIEZA 2 · subtítulo de presentación (solo vista, no persiste): canal propio hacia los subtítulos.
    subtitle: event => {
      if (!valid()) return;
      applyVoiceSubtitleEvent({ account, epoch: initial.historyEpoch, threadId }, event);
    },
    preview: event => {
      if (!valid()) return;
      if (event.role === 'assistant') {
        const replyTo = event.replyToTurnId ?? assistantReplies.get(event.turnId);
        if (interruptedReplies.has(event.turnId) || (replyTo && handedOffTurns.has(replyTo))) return;
        assistantReplies.set(event.turnId, replyTo ?? null);
      }
      if (useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages.some(message =>
        message.role === event.role && message.turnId === event.turnId)) return;
      useLiveTranscriptPreview.getState().show({ account, epoch: initial.historyEpoch,
        threadId, role: event.role, turnId: event.turnId, text: event.text,
        replyToTurnId: event.role === 'assistant' ? event.replyToTurnId : undefined });
    },
    speechStarted: (turnId, interruptedPlayback) => {
      if (!valid()) return;
      // Barge-in: al empezar a hablar se descarta el subtítulo de Uony sin terminar (A′).
      useVoiceSubtitles.getState().discardUnfinished({ account, epoch: initial.historyEpoch, threadId });
      interruptLiveSpeechProgress({ account, epoch: initial.historyEpoch, threadId });
      voiceStatus.startTurn(turnId);
      if (interruptedPlayback) {
        const priorUserTurnId = orderedUserTurns.at(-1);
        const oldReply = useLiveTranscriptPreview.getState().previews.findLast(item => item.role === 'assistant'
          && item.account === account && item.epoch === initial.historyEpoch && item.threadId === threadId);
        if (oldReply) interruptedReplies.add(oldReply.turnId);
        for (const buffered of [...bufferedAssistant]) {
          if (buffered.userTurnId !== priorUserTurnId) continue;
          interruptedReplies.add(buffered.event.turnId);
          bufferedAssistant.splice(bufferedAssistant.indexOf(buffered), 1);
        }
        useLiveTranscriptPreview.getState().clearAssistant(threadId);
      }
      if (turnId) rememberUser(turnId);
      if (turnId && !pendingUsers().some(item => item.turnId === turnId)) {
        useLiveTranscriptPreview.getState().startUser({ account, epoch: initial.historyEpoch,
          threadId, turnId, anchorIndex: nextAnchor() });
      }
    },
    speechEnded: turnId => {
      if (!valid()) return;
      rememberUser(turnId);
      if (useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages.some(message =>
        message.role === 'user' && message.turnId === turnId)) return;
      endSpeech({ account, epoch: initial.historyEpoch,
        threadId, turnId, anchorIndex: nextAnchor() });
    },
    transcript: event => {
      if (!valid()) return;
      if (event.role === 'assistant') {
        const replyTo = event.replyToTurnId ?? assistantReplies.get(event.turnId);
        if (interruptedReplies.has(event.turnId) || (replyTo && handedOffTurns.has(replyTo))) return;
        assistantReplies.set(event.turnId, replyTo ?? null);
        const userConfirmed = typeof replyTo === 'string' && useWorkspaceStore.getState().threads
          .find(item => item.id === threadId)?.messages.some(message => message.role === 'user' && message.turnId === replyTo);
        if (typeof replyTo === 'string' && !userConfirmed) {
          const pending = pendingUsers().find(item => item.turnId === replyTo);
          if (pending?.unavailable) {
            rebasePending(useWorkspaceStore.getState().insertLiveAssistantAfterPending(threadId, { role: 'assistant',
              text: event.text, turnId: event.turnId, replyToTurnId: replyTo,
              model: 'gemini-3.8-live' }, pending.anchorIndex,
            laterUserTurns(replyTo)), replyTo);
            useLiveTranscriptPreview.getState().remove(threadId, 'assistant', event.turnId);
            useWorkspaceStore.getState().retryHistory?.();
            return;
          }
          // El audio sigue; la burbuja queda provisional hasta colocar antes la frase de la persona.
          if (!bufferedAssistant.some(item => item.event.turnId === event.turnId))
            bufferedAssistant.push({ event: { turnId: event.turnId, text: event.text }, userTurnId: replyTo });
          useLiveTranscriptPreview.getState().show({ account, epoch: initial.historyEpoch,
            threadId, role: 'assistant', turnId: event.turnId, text: event.text, replyToTurnId: replyTo });
          return;
        }
        if (typeof replyTo === 'string') {
          rebasePending(useWorkspaceStore.getState().insertLiveAssistantMessage(threadId, { role: 'assistant',
            text: event.text, turnId: event.turnId, replyToTurnId: replyTo,
            model: 'gemini-3.8-live' }, replyTo), replyTo);
        } else if (!pendingUsers().length) {
          useWorkspaceStore.getState().pushMessage(threadId, { role: 'assistant', text: event.text,
            turnId: event.turnId, model: 'gemini-3.8-live' });
        } else {
          // Sin vínculo verificado no se adjudica la respuesta a la última frase por suposición.
          useLiveTranscriptPreview.getState().show({ account, epoch: initial.historyEpoch,
            threadId, role: 'assistant', turnId: event.turnId, text: event.text });
          return;
        }
      } else {
        rememberUser(event.turnId);
        voiceStatus.startTurn(orderedUserTurns.at(-1));
        const pending = pendingUsers().find(item => item.turnId === event.turnId);
        const message = { role: 'user' as const, text: event.text, turnId: event.turnId };
        if (pending) rebasePending(useWorkspaceStore.getState().insertLiveUserMessage(threadId, message, pending.anchorIndex,
          laterUserTurns(event.turnId),
          [...assistantReplies.entries()].filter(([, userTurnId]) => userTurnId === event.turnId).map(([assistantTurnId]) => assistantTurnId)), event.turnId);
        else useWorkspaceStore.getState().pushMessage(threadId, message);
      }
      useLiveTranscriptPreview.getState().remove(threadId, event.role, event.turnId);
      if (event.role === 'user') releaseAssistant(event.turnId);
      useWorkspaceStore.getState().retryHistory?.();
    },
    handoff: event => {
      const failure = failedTurns.get(event.turnId);
      if (!valid() || event.threadId !== threadId
        || failure && (failure.execution === 'not_started' || failure.requestId !== event.requestId)) return;
      failedTurns.delete(event.turnId); suppressReplies(event.turnId);
      voiceStatus.handoff(event.turnId);
      observeLiveHandoff(event, account, initial.historyEpoch);
    },
    semanticFailure: event => {
      if (!valid() || handedOffTurns.has(event.turnId) && !failedTurns.has(event.turnId)) return;
      if (semanticFailure(event)) { failedTurns.set(event.turnId, event); suppressReplies(event.turnId); }
    },
    progress: event => {
      if (!valid()) return;
      observeLiveProgress({ account, epoch: initial.historyEpoch, threadId }, event);
      if (event.type === 'speech_progress' && event.phase === 'failed')
        voiceStatus.notice(event.turnId, 'narration_unavailable');
    },
    // «Preparando su respuesta» dura hasta que la voz suena: con la narración en streaming el
    // envío se abre un segundo antes de que haya audio. El final del envío lo cierra siempre.
    speechAudible: requestId => { if (valid())
      endLiveSpeechProgress({ account, epoch: initial.historyEpoch, threadId }, requestId); },
    speechDelivery: event => { if (valid() && event.phase === 'end')
      endLiveSpeechProgress({ account, epoch: initial.historyEpoch, threadId }, event.requestId); },
    voiceNotice: event => {
      if (!valid() || handedOffTurns.has(event.turnId)) return;
      voiceStatus.notice(event.turnId, event.reason);
    },
    actionUnconfirmed: event => {
      if (!valid() || event.threadId !== threadId || handedOffTurns.has(event.turnId)) return;
      const index = orderedUserTurns.indexOf(event.turnId);
      if (index >= 0 && index < orderedUserTurns.length - 1) return;
      voiceStatus.actionUnconfirmed(event.turnId);
    },
    error: failure => {
      if (!valid()) return;
      const finished = failure.type === 'closed' && failure.code === 4000;
      const interrupted = liveReady ? 'La voz en directo se ha interrumpido. Tu borrador escrito se conserva.' : LIVE_START_FAILURE;
      // Solo códigos, fases y contadores acotados: sin audio, texto ni IDs.
      if (import.meta.env.DEV) console[finished ? 'info' : 'warn']('Uony Live diagnostic', JSON.stringify(failure));
      if (finished) {
        useWorkspaceStore.getState().retryHistory?.();
        stopVoice('La sesión de voz terminó tras 8 minutos. Los mensajes confirmados están guardados en el chat.');
        return;
      }
      // Fin anómalo de la voz: re-sincroniza la vista con la BD (igual que el fin normal de arriba) para que
      // el chat NO aparezca vacío. Los turnos están persistidos e intactos; solo faltaba volver a mostrarlos.
      useWorkspaceStore.getState().retryHistory?.();
      stopVoice(interrupted);
    },
  });
  if (valid()) {
    live = session;
    playVoiceChime('start');
    if (controls) { session.muteMicrophone(controls.microphoneMuted); session.muteSpeaker(controls.speakerMuted); }
  }
  else { stopReply?.(); stopReply = undefined; session.stop(); }
}
if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => stopVoice(''));
useWorkspaceStore.subscribe((state, previous) => {
  if (live && (state.activeThreadId !== previous.activeThreadId
    || state.historyAccount !== previous.historyAccount || state.historyEpoch !== previous.historyEpoch)) {
    stopVoice('Voz detenida al cambiar de cuenta o conversación.');
  } else if (mode && previous.activeThreadId && state.activeThreadId !== previous.activeThreadId) {
    stopVoice('Voz detenida al cambiar de conversación.');
  }
});
