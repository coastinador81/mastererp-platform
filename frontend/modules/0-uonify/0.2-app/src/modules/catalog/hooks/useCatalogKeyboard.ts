import { useEffect } from 'react';
import { useLatest } from '@/shared/hooks';
import { cssEscape } from './focus';
import { useCatalogStore } from './useCatalogStore';

// Capas del espacio de trabajo que Escape cierra antes (una tecla cierra una cosa):
// panel de hilos, menú de servicios, cuenta, menús del compositor y la
// conversación como hoja en pantallas estrechas.
const OTHER_LAYERS = [
  '.nav-drawer:not([hidden])',
  '.services-menu:not([hidden])',
  '.account-popover:not([hidden])',
  '.composer-model-menu:not([hidden])',
  '.composer-effort-menu:not([hidden])',
  '.composer-usage-panel:not([hidden])',
  '.composer-more-menu:not([hidden])',
  '.workspace-column.is-chat-sheet',
].join(', ');

/**
 * Escape en Producto (prototipo: el keydown de app-shell.js): primero cierra el
 * menú de un canal de la cabecera (y devuelve el foco a su botón); si no hay otra
 * capa abierta, pliega el catálogo abierto sin fijar (o el fijado, si el foco está
 * dentro de él).
 */
export function useCatalogKeyboard(setOpen: (open: boolean, options?: { restoreFocus?: boolean }) => void): void {
  const latest = useLatest(setOpen);
  useEffect(() => {
    let blocked = false;
    // En captura, antes de que otras capas se cierren con la misma tecla.
    const capture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') blocked = Boolean(document.querySelector(OTHER_LAYERS));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('dialog[open]')) return;
      if (blocked) return;
      const store = useCatalogStore.getState();
      if (store.channelMenuFor) {
        // El espacio no cierra nada más con esta tecla (su orden de Escape lo respeta).
        event.preventDefault();
        const trigger = store.channelMenuFor;
        store.setChannelMenu(null);
        document.querySelector<HTMLElement>(`[data-channel-menu="${cssEscape(trigger)}"]`)?.focus();
        return;
      }
      const focusedSide = document.activeElement?.closest('[data-product-sidebar]')?.getAttribute('data-product-sidebar');
      const { open, pinned } = store.drawer;
      if (!open || (pinned && focusedSide !== 'catalog')) return;
      event.preventDefault();
      latest.current(false, { restoreFocus: focusedSide === 'catalog' });
    };
    document.addEventListener('keydown', capture, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', capture, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [latest]);
}
