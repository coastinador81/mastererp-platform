import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComposerStore } from '../hooks/composerStore';
import { useWorkspaceStore, resetWorkspaceStore } from '../hooks/workspaceStore';
import { stopVoice, toggleVoice, toggleMicrophone, toggleSpeaker, startLiveVoicePilot } from '../hooks/voiceSession';
import { emitAssistantReply } from '../model/events';
import { sendPrompt } from '../hooks/conversation';
import { startLiveVoiceAudio, type LiveVoiceFailure } from '../hooks/liveVoiceAudio';
import { useLiveTranscriptPreview } from '../hooks/liveTranscriptPreview';
import { api } from '@/shared/api/client';
const account = vi.hoisted(() => ({ email: 'pilot@uonify.test' }));
vi.mock('@/modules/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/modules/auth')>(),
  currentAccountEmail: () => account.email,
}));
vi.mock('../hooks/conversation', () => ({ sendPrompt: vi.fn(() => true) }));
vi.mock('../hooks/liveVoiceAudio', () => ({ startLiveVoiceAudio: vi.fn() }));
let liveCallbacks: Parameters<typeof startLiveVoiceAudio>[0] | null = null;
const liveStop = vi.fn();
const liveMicrophone = vi.fn();
const liveSpeaker = vi.fn();
const liveFailure: LiveVoiceFailure = { type: 'closed', code: 1011, wasClean: false,
  phase: 'active', sentAudioFrames: 1, receivedAudioFrames: 0,
  transcriptEvents: 0, interruptionEvents: 0 };
class Recognition {
  static instances: Recognition[] = [];
  lang = ''; interimResults = false; continuous = false;
  onresult: ((event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  start = vi.fn(); abort = vi.fn();
  constructor() { Recognition.instances.push(this); }
  result(text: string, final = true) { this.onresult?.({ results: [{ isFinal: final, 0: { transcript: text } }] }); }
}
const latest = () => Recognition.instances.at(-1)!;
beforeEach(() => {
  stopVoice(''); resetWorkspaceStore(); vi.clearAllMocks(); Recognition.instances = [];
  liveCallbacks = null;
  vi.mocked(startLiveVoiceAudio).mockImplementation(callbacks => {
    liveCallbacks = callbacks;
    return { stop: liveStop, muteMicrophone: liveMicrophone, muteSpeaker: liveSpeaker };
  });
  useComposerStore.setState({ draft: '', status: '', listening: null });
  useLiveTranscriptPreview.getState().clear();
  vi.stubGlobal('SpeechRecognition', Recognition);
  vi.stubGlobal('speechSynthesis', undefined);
  vi.spyOn(api, 'get').mockResolvedValue({ accountEmail: account.email, liveVoice: 'not_integrated' });
});
afterEach(() => { stopVoice(''); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('Sesión de voz independiente del compositor', () => {
  it('el dictado deja el texto sin enviar', () => {
    toggleVoice('dictate'); latest().result('Quiero subir el juego');
    expect(useComposerStore.getState().draft).toBe('Quiero subir el juego');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(useComposerStore.getState().listening).toBeNull();
  });
  it('no envía resultados parciales y continúa escuchando después de responder', () => {
    toggleVoice('talk'); latest().result('Quiero subir', false);
    expect(sendPrompt).not.toHaveBeenCalled();
    const recognizer = latest();
    recognizer.result('Quiero subir el juego a Amazon');
    recognizer.result('Quiero subir el juego a Amazon');
    expect(sendPrompt).toHaveBeenCalledOnce();
    emitAssistantReply('¿Dónde tienes los archivos?');
    expect(Recognition.instances).toHaveLength(2);
    expect(latest().start).toHaveBeenCalledOnce();
  });
  it('acumula varios turnos y envía una sola vez con listo', () => {
    toggleVoice('talk'); latest().result('Espera a que diga listo'); latest().onend?.();
    latest().result('Quiero subir el juego'); latest().onend?.();
    latest().result('a Amazon'); latest().onend?.();
    expect(sendPrompt).not.toHaveBeenCalled();
    latest().result('listo');
    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('Quiero subir el juego a Amazon');
  });
  it('conserva la espera de listo tras un silencio que interrumpe el micrófono', () => {
    toggleVoice('talk'); latest().result('Espera a que diga listo'); latest().onend?.();
    latest().onend?.();
    toggleVoice('talk'); latest().result('Quiero subir el juego'); latest().onend?.();
    expect(sendPrompt).not.toHaveBeenCalled();
    latest().result('listo');
    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('Quiero subir el juego');
  });
  it('para conserva la instrucción incompleta y no la manda', () => {
    toggleVoice('talk'); latest().result('Espera a que diga listo'); latest().onend?.();
    latest().result('Cambia el precio'); latest().onend?.(); latest().result('para');
    expect(useComposerStore.getState().draft).toBe('Cambia el precio');
    expect(sendPrompt).not.toHaveBeenCalled();
  });
  it('deja de escuchar al cambiar de hilo y no reproduce respuestas tardías', () => {
    useWorkspaceStore.getState().createThread({ title: 'Uno', service: null, view: '' });
    toggleVoice('talk');
    useWorkspaceStore.getState().createThread({ title: 'Dos', service: null, view: '' });
    emitAssistantReply('Respuesta tardía');
    expect(useComposerStore.getState().listening).toBeNull();
    expect(Recognition.instances).toHaveLength(1);
  });
});

describe('Micrófono y altavoz independientes', () => {
  class Utterance {
    lang = ''; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  const speak = vi.fn(); const cancel = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    vi.stubGlobal('speechSynthesis', { speak, cancel });
  });
  it('silencia el micrófono, ignora resultados tardíos y conserva el borrador y el modo', () => {
    toggleVoice('talk'); latest().result('Quiero subir', false);
    const old = latest(); const late = old.onresult;
    toggleMicrophone();
    late?.({ results: [{ isFinal: true, 0: { transcript: 'no enviar' } }] });
    expect(old.abort).toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(useComposerStore.getState()).toMatchObject({ listening: 'talk', microphoneMuted: true, draft: 'Quiero subir' });
    toggleMicrophone();
    expect(Recognition.instances).toHaveLength(2);
    expect(useComposerStore.getState().microphoneMuted).toBe(false);
  });
  it('no abre el micrófono al acabar una respuesta si el usuario lo silenció', () => {
    toggleVoice('talk'); latest().result('Sube un producto'); toggleMicrophone();
    emitAssistantReply('¿Qué producto?');
    const spoken = speak.mock.calls.at(-1)![0] as Utterance;
    spoken.onend?.();
    expect(Recognition.instances).toHaveLength(1);
    expect(useComposerStore.getState().listening).toBe('talk');
  });
  it('corta el audio en curso, no lee nuevas respuestas silenciado y vuelve a leer tras activarlo', () => {
    toggleVoice('talk'); latest().result('Hola'); emitAssistantReply('Hola, dime');
    const spoken = speak.mock.calls.at(-1)![0] as Utterance;
    toggleSpeaker();
    expect(spoken.onend).toBeNull();
    expect(cancel).toHaveBeenCalled();
    expect(useComposerStore.getState()).toMatchObject({ speakerMuted: true, microphoneMuted: false, listening: 'talk' });
    latest().result('Prepara la ficha'); emitAssistantReply('Ficha lista');
    expect(speak).toHaveBeenCalledTimes(1);
    toggleSpeaker(); latest().result('Muéstramela'); emitAssistantReply('Aquí está');
    expect(speak).toHaveBeenCalledTimes(2);
  });
  it('activar el micrófono mientras espera una respuesta no inicia otro turno', () => {
    toggleVoice('talk'); latest().result('Prepara la ficha'); toggleMicrophone(); toggleMicrophone();
    expect(Recognition.instances).toHaveLength(1);
    emitAssistantReply('Ficha preparada');
    expect(Recognition.instances).toHaveLength(1);
    (speak.mock.calls.at(-1)![0] as Utterance).onend?.();
    expect(Recognition.instances).toHaveLength(2);
    stopVoice();
    expect(useComposerStore.getState()).toMatchObject({ listening: null, speakerMuted: false, microphoneMuted: false });
  });
});

describe('piloto Live y conversación clásica', () => {
  it('en la simulación el botón habitual conserva la conversación clásica', () => {
    useWorkspaceStore.setState({ historyAccount: account.email });
    toggleVoice('talk');
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    latest().result('Quiero crear un producto');
    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('Quiero crear un producto');
  });

  it('solo la entrada interna activa Live sin enviar texto por la ruta clásica', () => {
    vi.stubEnv('VITE_UONY_LIVE_PILOT', 'true');
    useWorkspaceStore.setState({ historyAccount: account.email });
    startLiveVoicePilot();
    expect(startLiveVoiceAudio).toHaveBeenCalledOnce();
    liveCallbacks!.status('listening');
    expect(useComposerStore.getState().listening).toBe('talk');
    expect(Recognition.instances).toHaveLength(0);
    emitAssistantReply('Resultado de otro trabajo');
    expect(sendPrompt).not.toHaveBeenCalled();
    toggleMicrophone(); toggleSpeaker();
    expect(liveMicrophone).toHaveBeenCalledWith(true);
    expect(liveSpeaker).toHaveBeenCalledWith(true);
    toggleVoice('talk');
    expect(liveStop).toHaveBeenCalledOnce();
    expect(useComposerStore.getState().listening).toBeNull();
  });

  it('vincula un hilo nuevo y consulta la transcripción persistida sin ejecutar otro turno', () => {
    vi.stubEnv('VITE_UONY_LIVE_PILOT', 'true');
    const retryHistory = vi.fn();
    useWorkspaceStore.setState({ historyAccount: account.email, retryHistory });
    useWorkspaceStore.setState({ activeProjectId: '11111111-1111-4111-8111-111111111111' });
    useComposerStore.getState().setDraft('borrador sin enviar');
    startLiveVoicePilot();
    const threadId = useWorkspaceStore.getState().activeThreadId;
    expect(threadId).toMatch(/^thread-/);
    expect(liveCallbacks?.threadId).toBe(threadId);
    expect(liveCallbacks?.projectId).toBe('11111111-1111-4111-8111-111111111111');
    expect(useWorkspaceStore.getState().pendingLiveThreadIds).toContain(threadId);
    expect(retryHistory).not.toHaveBeenCalled();
    liveCallbacks?.bound?.();
    expect(useWorkspaceStore.getState().pendingLiveThreadIds).toContain(threadId);
    expect(useWorkspaceStore.getState().boundLiveThreadIds).toContain(threadId);
    expect(retryHistory).toHaveBeenCalledOnce();
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'turn-1',
      text: 'Quiero preparar Basic Mini Bricks', final: true });
    expect(retryHistory).toHaveBeenCalledTimes(2);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(useComposerStore.getState().draft).toBe('borrador sin enviar');
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toEqual([
      { role: 'user', text: 'Quiero preparar Basic Mini Bricks', turnId: 'turn-1' },
    ]);
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'turn-1',
      text: 'Quiero preparar Basic Mini Bricks', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toHaveLength(1);
    stopVoice();
    liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'turn-1',
      text: 'Lo preparo contigo', final: true });
    expect(retryHistory).toHaveBeenCalledTimes(3);
  });

  it('mantiene previews fuera del borrador y las retira al persistir, interrumpir o cambiar de hilo', () => {
    const retryHistory = vi.fn();
    useWorkspaceStore.setState({ historyAccount: account.email, retryHistory });
    useComposerStore.getState().setDraft('Mi borrador propio');
    startLiveVoicePilot();
    const threadId = useWorkspaceStore.getState().activeThreadId!;
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'user', turnId: 'user-1', text: 'Quiero crear' });
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'assistant', turnId: 'assistant-1', text: 'Claro, puedo' });
    expect(useLiveTranscriptPreview.getState().previews).toHaveLength(2);
    expect(useComposerStore.getState().draft).toBe('Mi borrador propio');
    expect(sendPrompt).not.toHaveBeenCalled();
    liveCallbacks?.speechStarted?.(undefined, true);
    expect(useLiveTranscriptPreview.getState().previews).toMatchObject([{ role: 'user', text: 'Quiero crear' }]);
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'user-1', text: 'Quiero crear un producto', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toMatchObject([
      { role: 'user', turnId: 'user-1', text: 'Quiero crear un producto' },
    ]);
    expect(useLiveTranscriptPreview.getState().previews).toEqual([]);
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'assistant', turnId: 'assistant-2', text: 'Vamos a hacerlo' });
    useWorkspaceStore.getState().createThread({ title: 'Otro', service: null, view: 'default' });
    expect(useLiveTranscriptPreview.getState().previews).toEqual([]);
    expect(useComposerStore.getState().draft).toBe('Mi borrador propio');
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('si faltan subtítulos, informa sin parar Live ni modificar el borrador', () => {
    useWorkspaceStore.setState({ historyAccount: account.email });
    useComposerStore.getState().setDraft('Borrador propio');
    startLiveVoicePilot();
    liveCallbacks?.captionStatus?.('unavailable');
    expect(useComposerStore.getState().status).toBe('La voz sigue; transcripción en directo no disponible.');
    liveCallbacks?.status('speaking');
    expect(useComposerStore.getState().status).toBe('La voz sigue; transcripción en directo no disponible.');
    expect(useComposerStore.getState().draft).toBe('Borrador propio');
    expect(liveStop).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('retirar subtítulos provisionales conserva el ancla hasta el final de Live', () => {
    useWorkspaceStore.setState({ historyAccount: account.email });
    startLiveVoicePilot();
    const threadId = useWorkspaceStore.getState().activeThreadId!;
    liveCallbacks?.speechStarted?.('voice-1');
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'user', turnId: 'voice-1', text: 'Texto provisional' });
    liveCallbacks?.speechEnded?.('voice-1');
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'user', turnId: 'voice-1', text: '' });
    expect(useLiveTranscriptPreview.getState().pendingUsers.map(item => item.turnId)).toEqual(['voice-1']);
    liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'answer-1',
      replyToTurnId: 'voice-1', text: 'Te ayudo', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toEqual([]);
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'voice-1', text: 'Texto confirmado', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages.map(item => item.text))
      .toEqual(['Texto confirmado', 'Te ayudo']);
  });

  it('coloca dos frases de usuario antes de cada respuesta aunque la primera transcripción llegue tarde', () => {
    const retryHistory = vi.fn();
    useWorkspaceStore.setState({ historyAccount: account.email, retryHistory });
    useComposerStore.getState().setDraft('Borrador escrito intacto');
    startLiveVoicePilot();
    const threadId = useWorkspaceStore.getState().activeThreadId!;
    liveCallbacks?.speechStarted?.('user-1');
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'user', turnId: 'user-1', text: 'Primer producto' });
    liveCallbacks?.speechEnded?.('user-1');
    expect(useLiveTranscriptPreview.getState().pendingUsers).toMatchObject([
      { turnId: 'user-1', ended: true, anchorIndex: 0 },
    ]);
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'assistant', turnId: 'assistant-1', text: 'De acuerdo' });
    liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'assistant-1', replyToTurnId: 'user-1', text: 'De acuerdo', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toEqual([]);
    expect(useLiveTranscriptPreview.getState().previews.some(item => item.role === 'assistant')).toBe(true);
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'user-1', text: 'Primer producto', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toMatchObject([
      { role: 'user', text: 'Primer producto', turnId: 'user-1' },
      { role: 'assistant', text: 'De acuerdo', turnId: 'assistant-1' },
    ]);
    liveCallbacks?.speechStarted?.('user-2');
    liveCallbacks?.speechEnded?.('user-2');
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'user-2', text: 'Segundo producto', final: true });
    liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'assistant-2', replyToTurnId: 'user-2', text: 'Seguimos', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages.map(item => item.text)).toEqual([
      'Primer producto', 'De acuerdo', 'Segundo producto', 'Seguimos',
    ]);
    expect(useComposerStore.getState().draft).toBe('Borrador escrito intacto');
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('retira el marcador sin texto si Google no transcribe y no inventa un mensaje de usuario', () => {
    vi.useFakeTimers();
    try {
      useWorkspaceStore.setState({ historyAccount: account.email });
      startLiveVoicePilot();
      const threadId = useWorkspaceStore.getState().activeThreadId!;
      liveCallbacks?.speechStarted?.('silent-1');
      liveCallbacks?.speechEnded?.('silent-1');
      liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'reply-1', replyToTurnId: 'silent-1', text: 'Te escucho', final: true });
      expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toEqual([]);
      vi.advanceTimersByTime(13_000);
      expect(useLiveTranscriptPreview.getState().pendingUsers).toMatchObject([
        { turnId: 'silent-1', ended: true, unavailable: true },
      ]);
      expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toMatchObject([
        { role: 'assistant', text: 'Te escucho', turnId: 'reply-1' },
      ]);
      liveCallbacks?.speechStarted?.('silent-2'); liveCallbacks?.speechEnded?.('silent-2');
      liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'silent-2',
        text: 'Segunda frase', final: true });
      liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'silent-1', text: 'Frase tardía', final: true });
      expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages.map(item => item.text)).toEqual([
        'Frase tardía', 'Te escucho', 'Segunda frase',
      ]);
      expect(sendPrompt).not.toHaveBeenCalled();
    } finally { stopVoice(''); vi.useRealTimers(); }
  });

  it('mantiene separados dos turnos tardíos y retira la respuesta provisional al interrumpir', () => {
    useWorkspaceStore.setState({ historyAccount: account.email });
    startLiveVoicePilot();
    const threadId = useWorkspaceStore.getState().activeThreadId!;
    liveCallbacks?.speechStarted?.('user-a'); liveCallbacks?.speechEnded?.('user-a');
    liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'reply-a', replyToTurnId: 'user-a', text: 'Respuesta A', final: true });
    liveCallbacks?.speechStarted?.('user-b'); liveCallbacks?.speechEnded?.('user-b');
    expect(useLiveTranscriptPreview.getState().previews.some(item => item.turnId === 'reply-a')).toBe(true);
    liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'reply-b', replyToTurnId: 'user-b', text: 'Respuesta B', final: true });
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'user-a', text: 'Pregunta A', final: true });
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'user-b', text: 'Pregunta B', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages.map(item => item.text)).toEqual([
      'Pregunta A', 'Respuesta A', 'Pregunta B', 'Respuesta B',
    ]);
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'assistant', turnId: 'cut-off', text: 'Sigo hablando' });
    liveCallbacks?.speechStarted?.('user-c', true);
    expect(useLiveTranscriptPreview.getState().previews.some(item => item.turnId === 'cut-off')).toBe(false);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('ordena respuestas por su usuario aunque el segundo final llegue primero', () => {
    useWorkspaceStore.setState({ historyAccount: account.email });
    startLiveVoicePilot();
    const threadId = useWorkspaceStore.getState().activeThreadId!;
    liveCallbacks?.speechStarted?.('u1'); liveCallbacks?.speechEnded?.('u1');
    liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'a1',
      replyToTurnId: 'u1', text: 'Respuesta primera', final: true });
    liveCallbacks?.speechStarted?.('u2'); liveCallbacks?.speechEnded?.('u2');
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'u2', text: 'Pregunta segunda', final: true });
    liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'a2',
      replyToTurnId: 'u2', text: 'Respuesta segunda', final: true });
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'u1', text: 'Pregunta primera', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages.map(item => item.text)).toEqual([
      'Pregunta primera', 'Respuesta primera', 'Pregunta segunda', 'Respuesta segunda',
    ]);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('una interrupción no recupera después una respuesta bufferizada y cortada', () => {
    useWorkspaceStore.setState({ historyAccount: account.email });
    startLiveVoicePilot();
    const threadId = useWorkspaceStore.getState().activeThreadId!;
    liveCallbacks?.speechStarted?.('u1'); liveCallbacks?.speechEnded?.('u1');
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'assistant', turnId: 'a1',
      replyToTurnId: 'u1', text: 'Respuesta que se corta' });
    liveCallbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'a1',
      replyToTurnId: 'u1', text: 'Respuesta que se corta', final: true });
    liveCallbacks?.speechStarted?.('u2', true);
    liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'assistant', turnId: 'a1',
      replyToTurnId: 'u1', text: 'Fragmento tardío' });
    liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'u1', text: 'Pregunta primera', final: true });
    expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages.map(item => item.text))
      .toEqual(['Pregunta primera']);
    expect(useLiveTranscriptPreview.getState().previews.some(item => item.turnId === 'a1')).toBe(false);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('acepta un final tardío aunque la preview haya caducado sin guardar el interim', () => {
    vi.useFakeTimers();
    try {
      useWorkspaceStore.setState({ historyAccount: account.email });
      startLiveVoicePilot();
      const threadId = useWorkspaceStore.getState().activeThreadId!;
      liveCallbacks?.preview?.({ type: 'transcript_preview', role: 'user', turnId: 'turn-late', text: 'Frase provisional' });
      vi.advanceTimersByTime(8_000);
      expect(useLiveTranscriptPreview.getState().previews).toEqual([]);
      expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toEqual([]);
      liveCallbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'turn-late', text: 'Frase confirmada', final: true });
      expect(useWorkspaceStore.getState().threads.find(item => item.id === threadId)?.messages).toEqual([
        { role: 'user', turnId: 'turn-late', text: 'Frase confirmada' },
      ]);
      expect(sendPrompt).not.toHaveBeenCalled();
    } finally { stopVoice(''); vi.useRealTimers(); }
  });

  it('cierra la sesión al cambiar de hilo o identidad e ignora eventos tardíos', () => {
    vi.stubEnv('VITE_UONY_LIVE_PILOT', 'true');
    useWorkspaceStore.setState({ historyAccount: account.email });
    startLiveVoicePilot();
    const callbacks = liveCallbacks!;
    useWorkspaceStore.getState().createThread({ title: 'Otro producto', service: null, view: '' });
    expect(liveStop).toHaveBeenCalledOnce();
    callbacks.status('speaking');
    expect(useComposerStore.getState().listening).toBeNull();
    expect(sendPrompt).not.toHaveBeenCalled();
    startLiveVoicePilot();
    window.dispatchEvent(new Event('uonify:identity-changed'));
    expect(liveStop).toHaveBeenCalledTimes(2);
  });

  it('un fallo de Live detiene el audio y no reenvía por reconocimiento clásico', () => {
    vi.stubEnv('VITE_UONY_LIVE_PILOT', 'true');
    useWorkspaceStore.setState({ historyAccount: account.email });
    useComposerStore.getState().setDraft('borrador conservado');
    startLiveVoicePilot();
    const pendingThreadId = useWorkspaceStore.getState().activeThreadId;
    expect(useWorkspaceStore.getState().pendingLiveThreadIds).toContain(pendingThreadId);
    liveCallbacks!.error({ ...liveFailure, phase: 'startup' });
    expect(liveStop).toHaveBeenCalledOnce();
    expect(useComposerStore.getState().status).toBe('No se pudo iniciar la voz en directo. Tu borrador escrito se conserva.');
    expect(useComposerStore.getState().draft).toBe('borrador conservado');
    expect(useWorkspaceStore.getState().activeThreadId).toBeNull();
    expect(useWorkspaceStore.getState().threads.some(thread => thread.id === pendingThreadId)).toBe(false);
    expect(useWorkspaceStore.getState().pendingLiveThreadIds).toEqual([]);
    expect(Recognition.instances).toHaveLength(0);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('si Live ya estaba lista, informa una interrupción y conserva el borrador', () => {
    useWorkspaceStore.setState({ historyAccount: account.email });
    useComposerStore.getState().setDraft('Mi texto sin enviar');
    startLiveVoicePilot();
    liveCallbacks?.bound?.();
    liveCallbacks?.status('listening');
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});
    liveCallbacks?.error(liveFailure);
    expect(useComposerStore.getState().status).toBe('La voz en directo se ha interrumpido. Tu borrador escrito se conserva.');
    expect(diagnostic).toHaveBeenCalledWith('Uony Live diagnostic', JSON.stringify(liveFailure));
    expect(useComposerStore.getState().draft).toBe('Mi texto sin enviar');
    expect(Recognition.instances).toHaveLength(0);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('el cierre esperado a los 8 minutos conserva el hilo y consulta los mensajes finales', () => {
    const retryHistory = vi.fn();
    useWorkspaceStore.setState({ historyAccount: account.email, retryHistory });
    useComposerStore.getState().setDraft('borrador sin enviar');
    startLiveVoicePilot();
    const threadId = useWorkspaceStore.getState().activeThreadId;
    liveCallbacks?.bound?.();
    liveCallbacks?.status('listening');
    const diagnostic = vi.spyOn(console, 'info').mockImplementation(() => {});
    const expectedClose: LiveVoiceFailure = { ...liveFailure, code: 4000, wasClean: true,
      sentAudioFrames: 920, receivedAudioFrames: 42, transcriptEvents: 2 };
    liveCallbacks?.error(expectedClose);
    expect(diagnostic).toHaveBeenCalledWith('Uony Live diagnostic', JSON.stringify(expectedClose));
    expect(useComposerStore.getState().status).toBe('La sesión de voz terminó tras 8 minutos. Los mensajes confirmados están guardados en el chat.');
    expect(useComposerStore.getState().listening).toBeNull();
    expect(useComposerStore.getState().draft).toBe('borrador sin enviar');
    expect(useWorkspaceStore.getState().activeThreadId).toBe(threadId);
    expect(retryHistory).toHaveBeenCalledTimes(2);
    expect(liveStop).toHaveBeenCalledOnce();
    expect(Recognition.instances).toHaveLength(0);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('si se corta antes del enlace, conserva un mensaje escrito en el hilo local', () => {
    useWorkspaceStore.setState({ historyAccount: account.email });
    startLiveVoicePilot();
    const threadId = useWorkspaceStore.getState().activeThreadId!;
    useWorkspaceStore.getState().pushMessage(threadId, { role: 'user', text: 'Necesito continuar por escrito' });
    stopVoice();
    expect(useWorkspaceStore.getState().activeThreadId).toBe(threadId);
    expect(useWorkspaceStore.getState().threads.find(thread => thread.id === threadId)?.messages)
      .toEqual([{ role: 'user', text: 'Necesito continuar por escrito' }]);
    expect(useWorkspaceStore.getState().pendingLiveThreadIds).toEqual([]);
  });

  it('la entrada interna no inicia Live sin una cuenta preparada', () => {
    startLiveVoicePilot();
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    expect(Recognition.instances).toHaveLength(0);
  });
});
