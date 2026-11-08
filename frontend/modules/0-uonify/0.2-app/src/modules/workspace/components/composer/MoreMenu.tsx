import { useLayoutEffect, useRef, type ChangeEvent, type RefObject } from 'react';
import { useComposerStore } from '../../hooks/composerStore';
import { useDismissOnPointerDown } from '../../hooks/useDismiss';
import { FILE_UPLOADS_READY, MAX_ATTACHMENT_BYTES } from '../../model/composerOptions';
import { moreMenuPosition, toBox } from '../../model/placement';

const MORE_LABEL = FILE_UPLOADS_READY ? 'Añadir archivos y más' : 'Más opciones';

/**
 * «+» del compositor (composer-tools.js): empezar «Crea una imagen de …» y, cuando
 * exista la subida (FILE_UPLOADS_READY), añadir fotos o archivos (hasta 10 MB cada
 * uno), que se ven como fichas bajo el texto y se pueden quitar.
 */
export function MoreButton({ buttonRef, menuId }: { buttonRef: RefObject<HTMLButtonElement | null>; menuId: string }) {
  const open = useComposerStore(state => state.moreOpen);
  return (
    <button
      ref={buttonRef}
      className="composer-plus-button"
      type="button"
      data-composer-more=""
      aria-label={MORE_LABEL}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-controls={menuId}
      data-tooltip={MORE_LABEL}
      data-tooltip-align="start"
      onClick={() => useComposerStore.getState().setMoreOpen(!open)}
    >
      ＋
    </button>
  );
}

export interface MoreMenuProps {
  formRef: RefObject<HTMLFormElement | null>;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  menuId: string;
}

export function MoreMenu({ formRef, draftRef, buttonRef, menuId }: MoreMenuProps) {
  const open = useComposerStore(state => state.moreOpen);
  const menu = useRef<HTMLDivElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const close = () => useComposerStore.getState().setMoreOpen(false);

  // Solo lo cierra un clic fuera del compositor.
  useDismissOnPointerDown(open, [formRef], close);

  // Justo encima del botón «+», como el panel de uso sobre el suyo.
  useLayoutEffect(() => {
    const element = menu.current;
    const form = formRef.current;
    const button = buttonRef.current;
    if (!open || !element || !form || !button) return;
    const place = moreMenuPosition(toBox(form), toBox(button), element.offsetWidth);
    element.style.left = `${place.left}px`;
    element.style.bottom = `${place.bottom}px`;
    element.querySelector<HTMLElement>('button')?.focus();
  }, [open, formRef, buttonRef]);

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const store = useComposerStore.getState();
    const accepted: File[] = [];
    for (const file of Array.from(event.target.files ?? [])) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        store.setStatus(`${file.name} supera el límite de 10 MB.`);
        continue;
      }
      accepted.push(file);
    }
    event.target.value = '';
    if (accepted.length) store.addAttachments(accepted);
  };
  const run = (action: 'photos' | 'files' | 'image') => {
    close();
    if (action === 'photos') photos.current?.click();
    if (action === 'files') files.current?.click();
    if (action === 'image') {
      const text = 'Crea una imagen de ';
      useComposerStore.getState().setDraft(text);
      const draft = draftRef.current;
      draft?.focus();
      requestAnimationFrame(() => draft?.setSelectionRange(text.length, text.length));
    }
  };

  return (
    <>
      <div
        ref={menu}
        className="composer-more-menu"
        id={menuId}
        role="menu"
        aria-label="Añadir al mensaje"
        hidden={!open}
        onKeyDown={event => {
          if (event.key === 'Tab') close();
        }}
      >
        {FILE_UPLOADS_READY && <>
          <button type="button" role="menuitem" data-more-action="photos" onClick={() => run('photos')}>Añadir fotos</button>
          <button type="button" role="menuitem" data-more-action="files" onClick={() => run('files')}>Añadir archivos</button>
        </>}
        <button type="button" role="menuitem" data-more-action="image" onClick={() => run('image')}>Crear una imagen</button>
      </div>
      {FILE_UPLOADS_READY && <>
        <input ref={photos} type="file" accept="image/*" multiple hidden onChange={addFiles} />
        <input ref={files} type="file" accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,image/*" multiple hidden onChange={addFiles} />
      </>}
    </>
  );
}

export function Attachments() {
  const attachments = useComposerStore(state => state.attachments);
  const remove = useComposerStore(state => state.removeAttachment);
  return (
    <div className="composer-attachments" aria-label="Archivos añadidos" hidden={!attachments.length}>
      {attachments.map((file, index) => (
        <span key={`${file.name}-${index}`} className="composer-attachment">
          <span>{file.name}</span>
          <button type="button" aria-label={`Quitar ${file.name}`} onClick={() => remove(index)}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
