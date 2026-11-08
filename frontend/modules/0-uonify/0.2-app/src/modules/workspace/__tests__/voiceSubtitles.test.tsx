import { render, screen } from '@testing-library/react';
import { connectLiveTransport, type LiveTransportEvent } from '../api/liveTransport';
import { applyVoiceSubtitleEvent, subtitlesFor, useVoiceSubtitles, type VoiceSubtitleScope } from '../hooks/voiceSubtitles';
import { VoiceSubtitles } from '../components/voice/VoiceSubtitles';

const scope: VoiceSubtitleScope = { account: 'owner@example.test', epoch: 1, threadId: 'thread-one' };
const turns = () => subtitlesFor(useVoiceSubtitles.getState().turns, scope);
const sub = (role: 'user' | 'uony', text: string, finished: boolean): Extract<LiveTransportEvent, { type: 'subtitle' }> =>
  ({ type: 'subtitle', role, text, finished });
afterEach(() => useVoiceSubtitles.getState().clear());

// PIEZA 2 · A′: tu voz = un único mensaje final; Uony en vivo; barge-in descarta el parcial; solo vista.
describe('subtítulos de voz (PIEZA 2 · A′)', () => {
  it('tu voz solo aparece al cerrar el turno; los parciales en vivo no se muestran', () => {
    applyVoiceSubtitleEvent(scope, sub('user', 'Nece', false));
    expect(turns()).toHaveLength(0);
    applyVoiceSubtitleEvent(scope, sub('user', 'Necesito ayuda', true));
    expect(turns().map(turn => ({ role: turn.role, text: turn.text, finished: turn.finished })))
      .toEqual([{ role: 'user', text: 'Necesito ayuda', finished: true }]);
  });

  it('Uony se completa en vivo (mismo turno) y se fija al terminar', () => {
    applyVoiceSubtitleEvent(scope, sub('uony', 'Cla', false));
    applyVoiceSubtitleEvent(scope, sub('uony', 'Claro, te', false));
    expect(turns()).toHaveLength(1);
    expect(turns()[0]).toMatchObject({ text: 'Claro, te', finished: false });
    applyVoiceSubtitleEvent(scope, sub('uony', 'Claro, te ayudo', true));
    expect(turns()).toHaveLength(1);
    expect(turns()[0]).toMatchObject({ text: 'Claro, te ayudo', finished: true });
  });

  it('barge-in: un turno del usuario descarta el parcial de Uony sin terminar', () => {
    applyVoiceSubtitleEvent(scope, sub('user', 'Hola', true));
    applyVoiceSubtitleEvent(scope, sub('uony', 'Dime', true));
    applyVoiceSubtitleEvent(scope, sub('uony', 'Te explico lo que', false));
    expect(turns()).toHaveLength(3);
    applyVoiceSubtitleEvent(scope, sub('user', 'Mejor otra cosa', true));
    expect(turns().map(turn => turn.text)).toEqual(['Hola', 'Dime', 'Mejor otra cosa']);
  });

  it('discardUnfinished (barge-in desde la voz) descarta el parcial de Uony', () => {
    applyVoiceSubtitleEvent(scope, sub('uony', 'A medio', false));
    useVoiceSubtitles.getState().discardUnfinished(scope);
    expect(turns()).toHaveLength(0);
  });

  it('no mezcla hilos ni cuentas', () => {
    applyVoiceSubtitleEvent(scope, sub('user', 'Mío', true));
    const other: VoiceSubtitleScope = { account: scope.account, epoch: scope.epoch, threadId: 'thread-two' };
    applyVoiceSubtitleEvent(other, sub('user', 'Otro hilo', true));
    expect(turns()).toHaveLength(1);
    expect(subtitlesFor(useVoiceSubtitles.getState().turns, other)).toHaveLength(1);
  });

  it('renderiza los subtítulos con la marca «voz» y el cursor de Uony en vivo', () => {
    applyVoiceSubtitleEvent(scope, sub('user', 'Hola Uony', true));
    applyVoiceSubtitleEvent(scope, sub('uony', 'Te escucho', false));
    const { container } = render(<VoiceSubtitles {...scope} />);
    expect(screen.getByLabelText('Tú, por voz')).toHaveTextContent('Hola Uony');
    expect(screen.getByLabelText('Uony, por voz')).toHaveTextContent('Te escucho');
    expect(container.querySelector('.uony-writing-caret')).not.toBeNull();
  });
});

// El transporte DEBE aceptar el nuevo tipo `subtitle` (si no, cortaría la voz) y mantener los demás.
describe('liveTransport · tipo subtitle (PIEZA 2)', () => {
  class FakeSocket {
    static last: FakeSocket | null = null;
    binaryType: BinaryType = 'blob'; readyState = 0; bufferedAmount = 0;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null; onerror: (() => void) | null = null; onclose: ((event: CloseEvent) => void) | null = null;
    send = () => {};
    close = () => { this.readyState = 3; this.onclose?.({ code: 1000, wasClean: true } as CloseEvent); };
    constructor(readonly url: string) { FakeSocket.last = this; }
    receive(data: string) { this.onmessage?.({ data } as MessageEvent); }
    accept() {
      this.readyState = 1; this.onopen?.();
      this.receive(JSON.stringify({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' }));
      this.receive(JSON.stringify({ type: 'status', state: 'ready', inputFormat: 'pcm_s16le_16000', outputFormat: 'pcm_s16le_24000' }));
    }
  }
  const fixture = () => {
    const events: LiveTransportEvent[] = [];
    const transport = connectLiveTransport('thread-one', event => events.push(event),
      url => new FakeSocket(url) as unknown as WebSocket);
    return { transport, socket: FakeSocket.last!, events };
  };

  it('parsea un subtítulo válido sin cerrar el socket y alimenta los subtítulos', () => {
    const { transport, socket, events } = fixture();
    socket.accept();
    socket.receive(JSON.stringify({ type: 'subtitle', role: 'uony', text: 'Hola', finished: false }));
    expect(events.at(-1)).toEqual({ type: 'subtitle', role: 'uony', text: 'Hola', finished: false });
    expect(transport.state).toBe('ready');
    applyVoiceSubtitleEvent(scope, events.at(-1) as Extract<LiveTransportEvent, { type: 'subtitle' }>);
    expect(turns()[0]).toMatchObject({ role: 'uony', text: 'Hola', finished: false });
    transport.close();
  });

  it('rechaza un subtítulo mal formado (cierra por protocolo); un tipo existente sigue igual', () => {
    for (const bad of [{ role: 'bot' }, { finished: 'no' }, { extra: 1 }]) {
      const { transport, socket } = fixture(); socket.accept();
      socket.receive(JSON.stringify({ type: 'subtitle', role: 'uony', text: 'x', finished: false, ...bad }));
      expect(transport.state).toBe('closed');
    }
    const { transport, socket, events } = fixture(); socket.accept();
    socket.receive(JSON.stringify({ type: 'transcript', role: 'user', turnId: 'u1', text: 'Hola', final: true }));
    expect(events.at(-1)).toMatchObject({ type: 'transcript', role: 'user', turnId: 'u1', final: true });
    expect(transport.state).toBe('ready');
    transport.close();
  });
});
