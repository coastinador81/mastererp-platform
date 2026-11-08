import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, Icon } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { streamAssistant } from '../api/assistantStream';
import { navigate } from '../hooks/panelStore';
import type { Handoff, SourceRef, TranscriptTurn } from '../model/types';

export function SupportChat() {
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const conversation = useRef<string>(undefined);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const hintId = useId();

  useEffect(() => () => controller.current?.abort(), []);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(144, Math.max(48, element.scrollHeight))}px`;
  }, [message]);

  const send = async () => {
    if (!message.trim() || controller.current) return;
    const text = message.trim();
    const request = new AbortController();
    controller.current = request;
    setMessage(''); setBusy(true); setError(''); setSources([]); setHandoff(null);
    setTurns(previous => [...previous, { role: 'user', text }, { role: 'uony', text: '' }]);
    input.current?.focus();
    try {
      await streamAssistant({ message: text, conversationId: conversation.current }, event => {
        if (request.signal.aborted) return;
        if (event.type === 'meta') {
          conversation.current = event.conversationId;
          setSources(event.sources);
          setTurns(previous => previous.map((turn, i) => i === previous.length - 2 ? { ...turn, text: event.redactedMessage } : turn));
        }
        if (event.type === 'delta') setTurns(previous => previous.map((turn, i) => i === previous.length - 1 ? { ...turn, text: turn.text + event.text } : turn));
        if (event.type === 'done') setHandoff(event.handoff);
        if (event.type === 'error') setError(event.message);
      }, request.signal);
    } catch (reason) {
      if (!request.signal.aborted) setError(errorMessage(reason));
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  };

  return <section className="hlp-chat" aria-label="Hablar con Uony">
    <header className="hlp-chat-heading">
      <span className="hlp-chat-mark"><Icon name="uony" size={32} /></span>
      <div><h3>Habla con Uony </h3><p>Tu ayuda para seguir adelante.</p></div>
    </header>
    {turns.length === 0 ? <div className="hlp-chat-welcome">
      <h4>¿Qué necesitas resolver?</h4>
      <p>Pregúntame sobre tu cuenta, tus planes o cómo trabajar con Uonify.</p>
    </div> : null}
    <div className="hlp-transcript" role="log" aria-label="Conversación con Uony" aria-live="polite">
      {turns.map((turn, i) => <article key={i} className={`hlp-message hlp-message-${turn.role}`}>
        <strong>{turn.role === 'user' ? 'Tú' : <><Icon name="uony" size={18} /> Uony</>}</strong>
        <p>{turn.text || (busy ? 'Uony está preparando una respuesta…' : 'No se ha recibido una respuesta.')}</p>
      </article>)}
    </div>
    {sources.length ? <nav className="hlp-chat-sources" aria-label="Fuentes de la respuesta">
      <span>Para saber más</span>
      {sources.map(source => <button key={source.slug} type="button" onClick={() => navigate({ view: 'article', slug: source.slug })}>
        <Icon name="file-text" size={15} />{source.title}<Icon name="arrow-right" size={14} />
      </button>)}
    </nav> : null}
    <form className="hlp-chat-form" onSubmit={event => { event.preventDefault(); void send(); }}>
      <div className="hlp-composer">
        <textarea ref={input} aria-label="Tu pregunta para Uony" aria-describedby={hintId} placeholder="Pregunta a Uony…"
          rows={2} value={message} enterKeyHint="send" onChange={event => setMessage(event.target.value)}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            void send();
          }} />
        <div className="hlp-composer-bottom"><span><Icon name="uony" size={20} /> Uony</span>
          <button className="hlp-composer-send" type="submit" aria-label={busy ? 'Uony está respondiendo' : 'Enviar mensaje con Uony'} title="Enviar mensaje con Uony" disabled={busy || !message.trim()}>
            <Icon name={busy ? 'loader' : 'send'} size={18} />
          </button>
        </div>
      </div>
      <p className="hlp-chat-hint" id={hintId}>Enter para enviar · Mayús+Enter para un salto de línea</p>
    </form>
    {error ? <p role="alert" className="hlp-chat-error">{error}</p> : null}
    <Button disabled={busy} onClick={() => navigate({ view: 'new-ticket', prefill: {
      subject: handoff?.subject ?? 'Consulta al equipo de Uonify', category: handoff?.category ?? 'other', source: 'uony', conversationId: conversation.current, transcript: turns,
    } })}>{handoff ? 'Hablar con el equipo' : 'Necesito ayuda del equipo'}</Button>
  </section>;
}
