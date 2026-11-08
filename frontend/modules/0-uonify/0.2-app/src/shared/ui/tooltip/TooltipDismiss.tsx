import { useEffect } from 'react';

/**
 * Escape oculta los tooltips [data-tooltip] (`:root[data-tooltips-hidden]`)
 * hasta que el puntero se mueve o cambia el foco (prototipo: app-shell.js).
 * Devuelve la función que suelta los listeners.
 */
export function installTooltipDismiss(root: HTMLElement = document.documentElement): () => void {
  const hide = (event: KeyboardEvent) => {
    if (event.key === 'Escape') root.dataset.tooltipsHidden = 'true';
  };
  const show = () => {
    delete root.dataset.tooltipsHidden;
  };
  document.addEventListener('keydown', hide);
  document.addEventListener('pointermove', show, { passive: true });
  document.addEventListener('focusin', show);
  return () => {
    document.removeEventListener('keydown', hide);
    document.removeEventListener('pointermove', show);
    document.removeEventListener('focusin', show);
    show();
  };
}

/** Engancha installTooltipDismiss mientras está montado (uno en AppProviders). */
export function TooltipDismiss() {
  useEffect(() => installTooltipDismiss(), []);
  return null;
}
