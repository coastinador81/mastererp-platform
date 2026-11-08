import { useEffect, useState } from 'react';

/**
 * «Vista | HTML» (showHtmlPreview de DescriptionsTab.tsx). El componente
 * original no tenía `key` por producto: el modo pasa al siguiente producto y
 * vuelve a la vista previa solo al salir de la pestaña (cambio de pestaña,
 * cierre de la ficha, salida del servicio). Un cambio de producto desmonta y
 * monta la pestaña en el mismo commit: el montaje nuevo cancela la vuelta.
 */
let showHtmlPreview = true;
let resetTimer: ReturnType<typeof setTimeout> | null = null;

export function useHtmlPreviewMode(): [boolean, (preview: boolean) => void] {
  const [preview, setPreviewState] = useState(() => showHtmlPreview);

  useEffect(() => {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
    return () => {
      resetTimer = setTimeout(() => {
        showHtmlPreview = true;
        resetTimer = null;
      }, 0);
    };
  }, []);

  const setPreview = (next: boolean) => {
    showHtmlPreview = next;
    setPreviewState(next);
  };
  return [preview, setPreview];
}
