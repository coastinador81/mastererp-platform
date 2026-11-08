import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { useComposerStore } from '../hooks/composerStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { startLiveVoiceAudio } from '../hooks/liveVoiceAudio';
import { observeLiveHandoff } from '../hooks/liveHandoff';
import { stopVoice, toggleMicrophone, toggleSpeaker, toggleVoice } from '../hooks/voiceSession';

const account = vi.hoisted(() => ({ email: 'pilot@uonify.test' }));
vi.mock('@/shared/api/config', async importOriginal => ({
  ...await importOriginal<typeof import('@/shared/api/config')>(), USE_MOCKS: false,
}));
vi.mock('@/modules/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/modules/auth')>(),
  currentAccountEmail: () => account.email,
}));
vi.mock('../hooks/conversation', () => ({ sendPrompt: vi.fn(() => true) }));
vi.mock('../hooks/liveVoiceAudio', () => ({ startLiveVoiceAudio: vi.fn(() => ({
  stop: vi.fn(), muteMicrophone: vi.fn(), muteSpeaker: vi.fn(),
})) }));
vi.mock('../hooks/liveHandoff', () => ({ observeLiveHandoff: vi.fn() }));

class Recognition {
  static starts = 0;
  lang = ''; interimResults = false; continuous = false;
  onresult = null; onerror = null; onend = null;
  start() { Recognition.starts += 1; }
  abort() {}
}

beforeEach(() => {
  stopVoice(''); resetWorkspaceStore(); vi.clearAllMocks(); Recognition.starts = 0;
  useWorkspaceStore.setState({ historyAccount: account.email });
  useComposerStore.setState({ draft: 'borrador', status: '', listening: null });
  vi.stubGlobal('SpeechRecognition', Recognition);
  vi.stubGlobal('speechSynthesis', undefined);
});
afterEach(() => { stopVoice(''); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('botón de voz con disponibilidad verificada por cuenta', () => {
  it('abre Live solo tras `pilot_ready` de la misma cuenta', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ accountEmail: account.email, liveVoice: 'pilot_ready' });
    toggleVoice('talk');
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/uony/services');
    expect(startLiveVoiceAudio).toHaveBeenCalledOnce();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState().draft).toBe('borrador');
  });

  it('acepta el traspaso operativo solo del hilo de voz activo sin reenviar transcripciones', async () => {
    const post = vi.spyOn(api, 'post');
    vi.spyOn(api, 'get').mockResolvedValue({ accountEmail: account.email, liveVoice: 'pilot_ready' });
    toggleVoice('talk'); await Promise.resolve();
    const callbacks = vi.mocked(startLiveVoiceAudio).mock.calls[0][0];
    const threadId = callbacks.threadId;
    callbacks.handoff?.({ type: 'handoff', threadId: 'other-thread', turnId: 'voice-turn',
      requestId: 'request-one', status: 'queued' });
    expect(observeLiveHandoff).not.toHaveBeenCalled();
    callbacks.handoff?.({ type: 'handoff', threadId, turnId: 'voice-turn',
      requestId: 'request-one', status: 'queued' });
    expect(observeLiveHandoff).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
  });

  it('fuera del piloto conserva la voz clásica', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ accountEmail: account.email, liveVoice: 'not_integrated' });
    toggleVoice('talk');
    await Promise.resolve();
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    expect(Recognition.starts).toBe(1);
  });

  it('al agotar el cupo Live informa sin abrir otra sesión ni volver a voz clásica', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ accountEmail: account.email, liveVoice: 'pilot_exhausted' });
    toggleVoice('talk');
    await Promise.resolve();
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState()).toMatchObject({ draft: 'borrador', listening: null });
    expect(useComposerStore.getState().status).toBe('El cupo de pruebas de voz en directo está agotado. No se iniciará otra automáticamente. Tu borrador escrito se conserva.');
  });

  it('conserva el fallo de arranque al consultar después un cupo agotado', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ accountEmail: account.email, liveVoice: 'pilot_ready' })
      .mockResolvedValue({ accountEmail: account.email, liveVoice: 'pilot_exhausted' });
    toggleVoice('talk');
    await Promise.resolve();
    const callbacks = vi.mocked(startLiveVoiceAudio).mock.calls[0][0];
    callbacks.error({ type: 'closed', code: 1011, wasClean: false, phase: 'startup',
      sentAudioFrames: 0, receivedAudioFrames: 0, transcriptEvents: 0, interruptionEvents: 0 });
    expect(useComposerStore.getState().status).toBe('No se pudo iniciar la voz en directo. Tu borrador escrito se conserva.');

    toggleVoice('talk');
    await Promise.resolve();
    expect(useComposerStore.getState().status).toBe('No se pudo iniciar la voz en directo. El cupo de pruebas está agotado; revisaremos el fallo antes de otro intento. Tu borrador escrito se conserva.');
    expect(startLiveVoiceAudio).toHaveBeenCalledOnce();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState()).toMatchObject({ draft: 'borrador', listening: null });

    toggleVoice('talk');
    await Promise.resolve();
    expect(useComposerStore.getState().status).toBe('No se pudo iniciar la voz en directo. El cupo de pruebas está agotado; revisaremos el fallo antes de otro intento. Tu borrador escrito se conserva.');
  });

  it('si la cuenta aún no tiene el historial listo no abre voz clásica ni pierde el borrador', () => {
    const get = vi.spyOn(api, 'get');
    useWorkspaceStore.setState({ historyAccount: null });
    toggleVoice('talk');
    expect(get).not.toHaveBeenCalled();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState()).toMatchObject({ draft: 'borrador', listening: null });
    expect(useComposerStore.getState().status).toMatch(/se está preparando/);
  });

  it('si falla la consulta no cambia silenciosamente a voz clásica', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('sin conexión'));
    toggleVoice('talk');
    await vi.waitFor(() => expect(useComposerStore.getState().status).toMatch(/No pudimos comprobar/));
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState()).toMatchObject({ draft: 'borrador', listening: null });
  });

  it('una respuesta sin disponibilidad explícita no activa voz clásica', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ accountEmail: account.email });
    toggleVoice('talk');
    await Promise.resolve();
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState().status).toMatch(/No pudimos comprobar/);
  });

  it('un error tardío tras cambiar de hilo no inicia voz clásica en el nuevo hilo', async () => {
    let reject!: (reason: Error) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    toggleVoice('talk');
    useWorkspaceStore.getState().createThread({ title: 'Otro producto', service: null, view: 'default' });
    reject(new Error('sin conexión'));
    await vi.waitFor(() => expect(useComposerStore.getState().status).toMatch(/cambiar de conversación/));
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState().draft).toBe('borrador');
  });

  it('rechaza un piloto asignado a otra identidad sin caer a voz clásica', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ accountEmail: 'other@uonify.test', liveVoice: 'pilot_ready' });
    toggleVoice('talk');
    await Promise.resolve();
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState().status).toMatch(/verificar tu cuenta/);
  });

  it('si se cancela antes de resolver disponibilidad no abre el micrófono tarde', async () => {
    let resolve!: (value: unknown) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(value => { resolve = value; }));
    toggleVoice('talk');
    toggleVoice('talk');
    resolve({ accountEmail: account.email, liveVoice: 'pilot_ready' });
    await Promise.resolve();
    expect(startLiveVoiceAudio).not.toHaveBeenCalled();
    expect(Recognition.starts).toBe(0);
  });

  it('conserva ambos silencios durante la consulta y al abrir Live sin iniciar voz clásica', async () => {
    let resolve!: (value: unknown) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(value => { resolve = value; }));
    toggleVoice('talk');
    toggleSpeaker();
    toggleMicrophone();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState()).toMatchObject({ speakerMuted: true, microphoneMuted: true });

    resolve({ accountEmail: account.email, liveVoice: 'pilot_ready' });
    await Promise.resolve();
    const session = vi.mocked(startLiveVoiceAudio).mock.results[0]?.value;
    expect(startLiveVoiceAudio).toHaveBeenCalledOnce();
    expect(session?.muteSpeaker).toHaveBeenCalledWith(true);
    expect(session?.muteMicrophone).toHaveBeenCalledWith(true);
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState()).toMatchObject({
      speakerMuted: true, microphoneMuted: true, listening: 'talk', draft: 'borrador',
    });
  });

  it('fuera del piloto conserva el micrófono silenciado hasta que el usuario lo reactive', async () => {
    let resolve!: (value: unknown) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(value => { resolve = value; }));
    toggleVoice('talk');
    toggleMicrophone();
    resolve({ accountEmail: account.email, liveVoice: 'not_integrated' });
    await Promise.resolve();
    expect(Recognition.starts).toBe(0);
    expect(useComposerStore.getState()).toMatchObject({ microphoneMuted: true, listening: 'talk' });
    toggleMicrophone();
    expect(Recognition.starts).toBe(1);
  });
});
