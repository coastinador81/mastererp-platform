import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Pantalla completa del visor (E15). Si el navegador rechaza o no resuelve la
 * petición, queda el modo a toda la ventana (fixed inset-0) del original, y el
 * mismo botón o Escape lo cierran; un rechazo devuelve el estado.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [isFullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKeydown);
    const element = ref.current;
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('keydown', onKeydown);
      if (element && document.fullscreenElement === element) Promise.resolve(document.exitFullscreen?.()).catch(() => {});
    };
  }, [ref]);

  const toggle = useCallback(() => {
    const element = ref.current;
    if (!document.fullscreenElement && !isFullscreen) {
      if (!element || typeof element.requestFullscreen !== 'function') return;
      setFullscreen(true);
      Promise.resolve(element.requestFullscreen()).catch(() => setFullscreen(false));
    } else {
      if (document.fullscreenElement) Promise.resolve(document.exitFullscreen?.()).catch(() => {});
      setFullscreen(false);
    }
  }, [ref, isFullscreen]);

  return { isFullscreen, toggle };
}
