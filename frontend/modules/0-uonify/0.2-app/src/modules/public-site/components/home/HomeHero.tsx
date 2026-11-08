import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation } from 'react-router';
import { startAccess } from '../../hooks/usePublicSession';
import { PATHS } from '../../model/views';
import { HomeComposer } from './HomeComposer';
import { PromptSuggestions } from './PromptSuggestions';

/**
 * Centro de la portada: anuncio, «Hazlo posible.», compositor, ideas, estado y error
 * (landing.js). Una petición vacía muestra el error; con texto, abre el acceso.
 */
export function HomeHero() {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);
  const [status, setStatus] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { hash } = useLocation();

  useEffect(() => {
    if (hash !== '#composer') return undefined;
    const frame = requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  const onDraftInput = useCallback((value: string) => { setDraft(value); setError(false); }, []);
  const fillDraft = useCallback((value: string) => {
    flushSync(() => onDraftInput(value));
    const field = textareaRef.current;
    field?.focus();
    field?.setSelectionRange(value.length, value.length);
  }, [onDraftInput]);
  const report = useCallback((message: string) => setStatus(message), []);

  const onSubmitPrompt = () => {
    const prompt = (textareaRef.current?.value ?? draft).trim();
    if (!prompt) { setError(true); textareaRef.current?.focus(); return; }
    setError(false);
    startAccess(prompt);
  };

  return (
    <main className="focus-main" id="contenido" tabIndex={-1}>
      <section className="focus-hero" aria-labelledby="hero-title">
        <Link className="announcement" to={PATHS.productos}><span aria-hidden="true">✦</span> Una forma más clara de operar tu e-commerce <i aria-hidden="true">→</i></Link>
        <h1 id="hero-title">Hazlo<em> posible.</em></h1>
        <HomeComposer draft={draft} onDraftInput={onDraftInput} fillDraft={fillDraft} onSubmitPrompt={onSubmitPrompt} report={report} textareaRef={textareaRef} />
        <p className="composer-live-status" data-composer-status role="status" aria-live="polite" hidden={!status}>{status}</p>
        <PromptSuggestions onPick={fillDraft} />
        <p id="prompt-error" className="prompt-error" role="alert" hidden={!error}>Escribe una petición para continuar.</p>
      </section>
    </main>
  );
}
