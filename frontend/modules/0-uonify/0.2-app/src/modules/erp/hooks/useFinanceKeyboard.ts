import { useEffect } from 'react';
import { useLatest } from '@/shared/hooks';
import type { DrawerState } from '@/modules/catalog';

// Capas del espacio de trabajo que Escape cierra antes (una tecla cierra una cosa): las
// mismas que Producto (catalog/hooks/useCatalogKeyboard.ts).
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
 * Escape en Finanzas, igual que en Producto (useCatalogKeyboard, sin el menú de canal):
 * si no hay otra capa abierta, pliega la lista abierta sin fijar, o la fijada si el foco
 * está dentro de ella (y entonces el foco vuelve al icono del raíl).
 */
export function useFinanceKeyboard(
  side: string,
  read: () => DrawerState,
  setOpen: (open: boolean, options?: { restoreFocus?: boolean }) => void,
): void {
  const latestRead = useLatest(read);
  const latestSet = useLatest(setOpen);
  useEffect(() => {
    let blocked = false;
    // En captura, antes de que otras capas se cierren con la misma tecla.
    const capture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') blocked = Boolean(document.querySelector(OTHER_LAYERS));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('dialog[open]') || blocked) return;
      const focusedSide = document.activeElement?.closest('[data-product-sidebar]')?.getAttribute('data-product-sidebar');
      const { open, pinned } = latestRead.current();
      if (!open || (pinned && focusedSide !== side)) return;
      event.preventDefault();
      latestSet.current(false, { restoreFocus: focusedSide === side });
    };
    document.addEventListener('keydown', capture, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', capture, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [side, latestRead, latestSet]);
}
