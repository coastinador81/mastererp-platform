import { useCallback, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useSession } from '@/modules/auth';
import { VoiceTalkButton, VoiceAudioControls } from '@/shared/ui';
import { useEventListener } from '@/shared/hooks';
import { isSignedIn, startAccess } from '../../hooks/usePublicSession';
import { useSpeechInput } from '../../hooks/useSpeechInput';
import { CREATE_IMAGE_PREFIX, FILE_ACCEPT, PHOTO_ACCEPT, splitAttachments } from '../../model/composerOptions';
import { moreMenuPosition } from '../../model/placement';
import { ComposerAiPicker } from './ComposerAiPicker';
import { GoogleAiPicker } from '@/modules/workspace';
import { USE_MOCKS } from '@/shared/api/config';
import { ComposerAttachments, ComposerMoreMenu, type MoreAction } from './ComposerMoreMenu';

interface HomeComposerProps {
  draft: string;
  /** Escritura normal: actualiza el borrador y oculta el error. */
  onDraftInput: (value: string) => void;
  /** Rellena el borrador, enfoca el campo y deja el cursor al final. */
  fillDraft: (value: string) => void;
  onSubmitPrompt: () => void;
  report: (message: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

const documentTarget = typeof document === 'undefined' ? null : document;

/**
 * Compositor de la portada (#composer): campo, menú «+», selector de IA, voz y envío.
 * Enviar abre el acceso de Uonify con la petición (landing.js + composer-tools.js).
 */
export function HomeComposer({ draft, onDraftInput, fillDraft, onSubmitPrompt, report, textareaRef }: HomeComposerProps) {
  const { status } = useSession();
  const signedIn = isSignedIn(status);
  const formRef = useRef<HTMLFormElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuId = `composer-more-menu-${useId().replace(/:/g, '')}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);

  const submit = useCallback(() => formRef.current?.requestSubmit(), []);
  const focusDraft = useCallback(() => textareaRef.current?.focus(), [textareaRef]);
  const appendTranscript = useCallback((transcript: string) => {
    flushSync(() => onDraftInput(`${(textareaRef.current?.value ?? '').trim()} ${transcript}`.trim()));
  }, [onDraftInput, textareaRef]);
  const speech = useSpeechInput({ onTranscript: appendTranscript, report, submit, focusDraft });

  // La captura evita que un control abra menús, archivos o micrófono antes del acceso.
  const requireAccess = (event: MouseEvent<HTMLFormElement>) => {
    if (signedIn || !(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (!button || !event.currentTarget.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);
    startAccess(draft);
  };

  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = 'auto';
    if (draft) field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  }, [draft, textareaRef]);

  useLayoutEffect(() => {
    const form = formRef.current;
    const menu = menuRef.current;
    const button = moreRef.current;
    if (!menuOpen || !form || !menu || !button) return;
    const position = moreMenuPosition(form.getBoundingClientRect(), button.getBoundingClientRect(), menu.offsetWidth);
    menu.style.left = `${position.left}px`;
    menu.style.bottom = `${position.bottom}px`;
    menu.querySelector('button')?.focus();
  }, [menuOpen]);

  useEventListener('pointerdown', event => {
    if (menuOpen && !formRef.current?.contains(event.target as Node)) setMenuOpen(false);
  }, documentTarget);
  useEventListener('keydown', event => {
    if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); moreRef.current?.focus(); }
  }, documentTarget);

  const onAction = (action: MoreAction) => {
    setMenuOpen(false);
    if (action === 'photos') photoRef.current?.click();
    if (action === 'files') fileRef.current?.click();
    if (action === 'image') fillDraft(CREATE_IMAGE_PREFIX);
  };

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const { accepted, rejected } = splitAttachments([...(event.currentTarget.files ?? [])]);
    rejected.forEach(file => report(`${file.name} supera el límite de 10 MB.`));
    event.currentTarget.value = '';
    if (accepted.length) setAttachments(current => [...current, ...accepted]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };


  return (
    <form className="composer home-composer" id="composer" aria-label="Escribe a Uony" ref={formRef} onClickCapture={requireAccess}
      onSubmit={event => { event.preventDefault(); if (!signedIn) startAccess(draft); else onSubmitPrompt(); }}>
      <label className="composer-field">
        <span className="sr-only">Describe qué quieres conseguir</span>
        <textarea
          ref={textareaRef}
          aria-describedby="prompt-error"
          id="composer-text"
          rows={1}
          maxLength={3000}
          placeholder="¿Qué quieres hacer posible hoy?"
          value={draft}
          onChange={event => onDraftInput(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ComposerAttachments files={attachments} onRemove={index => setAttachments(current => current.filter((_, i) => i !== index))} />
      </label>
      <div className="composer-controls">
        <div className="composer-tool-group">
          <button
            ref={moreRef}
            className="composer-plus-button"
            type="button"
            data-composer-more
            aria-label="Más opciones"
            aria-expanded={signedIn ? menuOpen : undefined}
            aria-haspopup={signedIn ? 'menu' : 'dialog'}
            aria-controls={signedIn ? menuId : undefined}
            title="Más opciones"
            onClick={() => setMenuOpen(open => !open)}
          >＋</button>
          <button className="home-composer-nav" type="button" aria-label="Hilos" title="Inicia sesión para ver tus hilos" onClick={() => startAccess()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H9l-4 4V5Z" /></svg>
          </button>
          <button className="home-composer-nav" type="button" aria-label="Límites de uso" title="Inicia sesión para consultar tu uso" onClick={() => startAccess()}>
            <span className="home-composer-usage-ring" aria-hidden="true" />
          </button>
        </div>
        <div className="composer-tool-group composer-tool-group-right">
          {USE_MOCKS ? <ComposerAiPicker formRef={formRef} /> : <GoogleAiPicker form={formRef} onSignIn={() => startAccess(draft)} />}
          <VoiceAudioControls talking={speech.mode === 'talk'} dictating={speech.mode === 'dictate'} microphoneMuted={speech.microphoneMuted} speakerMuted={speech.speakerMuted} dictate={() => speech.start('dictate')} toggleMicrophone={speech.toggleMicrophone} toggleSpeaker={speech.toggleSpeaker} />
          <VoiceTalkButton account="visitor" active={speech.mode === 'talk'} listen={() => speech.start('talk')} />
          <button className="send-button" type="submit" aria-label="Enviar petición"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>
        </div>
      </div>
      <ComposerMoreMenu ref={menuRef} id={menuId} open={signedIn && menuOpen} onAction={onAction} onClose={() => setMenuOpen(false)} />
      <input ref={photoRef} type="file" accept={PHOTO_ACCEPT} multiple hidden onChange={addFiles} />
      <input ref={fileRef} type="file" accept={FILE_ACCEPT} multiple hidden onChange={addFiles} />
    </form>
  );
}
