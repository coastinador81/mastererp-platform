import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useLatest } from '@/shared/hooks';

/**
 * Abre y cierra un <dialog> nativo como modal según `open` (prototipo:
 * showModal/close). Escape y la petición de cierre del navegador llaman a
 * `onCancel`; el diálogo solo se cierra cuando el estado lo decide.
 */
export function useNativeDialog(open: boolean, onCancel: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useLatest(onCancel);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) {
      // jsdom no implementa showModal: se abre con el atributo.
      if (typeof element.showModal === 'function' && element.isConnected) {
        try {
          element.showModal();
        } catch {
          element.setAttribute('open', '');
        }
      } else element.setAttribute('open', '');
    } else if (!open && element.open) {
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
    }
  }, [open]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const onNativeCancel = (event: Event) => {
      event.preventDefault();
      cancel.current();
    };
    element.addEventListener('cancel', onNativeCancel);
    return () => element.removeEventListener('cancel', onNativeCancel);
  }, [cancel]);

  // Evitar el comportamiento por defecto de Escape impide también el «cancel»
  // nativo, así que no se ejecuta dos veces.
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    cancel.current();
  };

  return { ref, onKeyDown };
}
