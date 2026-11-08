import { act, renderHook } from '@testing-library/react';
import { useSpeechInput } from '../hooks/useSpeechInput';

class Recognition {
  static instances: Recognition[] = [];
  lang = ''; interimResults = false; continuous = false;
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  start = vi.fn(); abort = vi.fn();
  constructor() { Recognition.instances.push(this); }
  result(text: string) { this.onresult?.({ results: [[{ transcript: text }]] }); }
}
class Utterance {
  lang = ''; onend: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
const speak = vi.fn(); const cancel = vi.fn();
const options = { onTranscript: vi.fn(), submit: vi.fn(), report: vi.fn(), focusDraft: vi.fn() };
const last = () => Recognition.instances.at(-1)!;
const reply = () => window.dispatchEvent(new CustomEvent('uonify:assistant-reply', { detail: { text: 'Respuesta de Uony' } }));
beforeEach(() => {
  vi.clearAllMocks(); Recognition.instances = [];
  vi.stubGlobal('SpeechRecognition', Recognition);
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', { speak, cancel });
});
afterEach(() => vi.unstubAllGlobals());

test('portada mantiene la conversación al silenciar y permite reactivar el micrófono', () => {
  const { result, unmount } = renderHook(() => useSpeechInput(options));
  act(() => result.current.start('talk'));
  const old = last();
  act(() => result.current.toggleMicrophone());
  expect(old.abort).toHaveBeenCalled();
  expect(result.current).toMatchObject({ mode: 'talk', microphoneMuted: true });
  act(() => result.current.toggleMicrophone());
  expect(Recognition.instances).toHaveLength(2);
  act(() => last().result('Hola'));
  act(() => result.current.toggleMicrophone());
  act(reply);
  act(() => (speak.mock.calls[0][0] as Utterance).onend?.());
  expect(Recognition.instances).toHaveLength(2);
  expect(result.current.mode).toBe('talk');
  unmount();
});

test('altavoz silencioso conserva respuesta escrita y elimina escucha y respuestas tardías al salir', () => {
  const { result, unmount } = renderHook(() => useSpeechInput(options));
  act(() => result.current.start('talk'));
  act(() => result.current.toggleSpeaker());
  act(() => last().result('Hola'));
  act(reply);
  expect(options.submit).toHaveBeenCalledOnce();
  expect(speak).not.toHaveBeenCalled();
  act(() => result.current.toggleSpeaker());
  act(() => last().result('Otra pregunta'));
  act(reply);
  expect(speak).toHaveBeenCalledOnce();
  act(() => result.current.toggleSpeaker());
  expect((speak.mock.calls[0][0] as Utterance).onend).toBeNull();
  act(() => last().result('No responder tras salir'));
  unmount();
  act(reply);
  expect(speak).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalled();
});
