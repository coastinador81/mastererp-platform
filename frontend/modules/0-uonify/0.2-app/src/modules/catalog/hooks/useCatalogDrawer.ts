import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import {
  WIDE_SCREEN_QUERY,
  applyDrawer,
  defaultLayout,
  isNarrowWidth,
  layoutForView,
  layoutOnNarrow,
  toggleFromHeader,
  toggleFromRail,
  type DrawerState,
} from '../model/layout';
import { hasEditingFocus, isUsable, mediaMatches } from './focus';
import { useCatalogStore } from './useCatalogStore';

interface SetOptions {
  trigger?: HTMLElement | null;
  restoreFocus?: boolean;
}

/**
 * Catálogo lateral de Producto (prototipo: applyDefaultProductLayout,
 * syncProductDrawers, setProductDrawer, el observador de tamaño y los clics del raíl
 * y de la cabecera). La columna del módulo es estrecha a ≤ 760 px: ahí no se fija.
 * Devuelve las referencias que la vista pone en la mesa, el botón de la cabecera del
 * catálogo y el icono del raíl (a los que va el foco).
 */
export function useCatalogDrawer(sheet: string, hasSheet: boolean) {
  const drawer = useCatalogStore(state => state.drawer);
  const workbench = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const railMain = useRef<HTMLButtonElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const lastSheet = useRef<string | null>(null);

  const measure = useCallback(() => {
    const element = workbench.current;
    return element ? isNarrowWidth(element.clientWidth) : false;
  }, []);
  // Ancho de la columna del módulo, leído del DOM (se actualiza al redimensionar).
  const subscribeWidth = useCallback((notify: () => void) => {
    const element = workbench.current;
    if (!element || typeof ResizeObserver === 'undefined') return () => {};
    const observer = new ResizeObserver(notify);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const narrow = useSyncExternalStore(subscribeWidth, measure, () => false);

  // Al entrar en Producto y al abrir o cerrar una ficha (antes de pintar).
  useLayoutEffect(() => {
    const store = useCatalogStore.getState();
    const narrowNow = measure();
    let next: DrawerState = store.drawer;
    if (!store.layoutReady) {
      store.markLayoutReady();
      next = defaultLayout(next, mediaMatches(WIDE_SCREEN_QUERY));
    }
    const entering = lastSheet.current === null;
    const leavingSheet = !entering && lastSheet.current !== 'none' && !hasSheet;
    store.setDrawer(layoutForView(next, { hasSheet, entering, leavingSheet, narrow: narrowNow }));
    lastSheet.current = sheet;
  }, [sheet, hasSheet, measure]);

  // Cuando la columna se estrecha (ventana o conversación), el catálogo deja de
  // estar fijado y se pliega, salvo que la persona esté escribiendo en él.
  useEffect(() => {
    const element = workbench.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    let wasNarrow = measure();
    const observer = new ResizeObserver(() => {
      const now = measure();
      const crossed = now && !wasNarrow;
      wasNarrow = now;
      if (!crossed) return;
      const store = useCatalogStore.getState();
      store.setDrawer(layoutOnNarrow(store.drawer, hasEditingFocus(element.querySelector('#product-catalog-drawer'))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  /** Abre o pliega el catálogo con el foco del prototipo (setProductDrawer). */
  const apply = useCallback((next: DrawerState, { trigger = null, restoreFocus = true }: SetOptions = {}) => {
    if (next.open && trigger) origin.current = trigger;
    const panel = workbench.current?.querySelector('#product-catalog-drawer');
    const focusWasInside = Boolean(panel?.contains(document.activeElement));
    flushSync(() => useCatalogStore.getState().setDrawer(next));
    if (next.open) {
      toggle.current?.focus({ preventScroll: true });
      return;
    }
    if (!restoreFocus && !focusWasInside) return;
    // El botón de la cabecera se oculta al plegar: el foco vuelve al icono del raíl.
    const back = origin.current;
    const visible = back && isUsable(back) && back.getClientRects().length > 0;
    (visible ? back : railMain.current)?.focus({ preventScroll: true });
  }, []);

  const setOpen = useCallback((open: boolean, options?: SetOptions) => {
    apply(applyDrawer(useCatalogStore.getState().drawer, open, measure()), options);
  }, [apply, measure]);

  /** Icono del raíl (o el número del catálogo): abre y fija, o pliega. */
  const onRailClick = useCallback((trigger: HTMLElement, fromRail: boolean) => {
    apply(toggleFromRail(useCatalogStore.getState().drawer, measure(), fromRail), { trigger });
  }, [apply, measure]);

  /** Botón de la cabecera del catálogo: plegar, o fijar si estaba abierto sin fijar. */
  const onToggleClick = useCallback((trigger: HTMLElement) => {
    apply(toggleFromHeader(useCatalogStore.getState().drawer, measure()), { trigger });
  }, [apply, measure]);

  /** Un clic o el foco en el centro pliegan un catálogo abierto sin fijar. */
  const collapseUnpinned = useCallback(() => {
    const current = useCatalogStore.getState().drawer;
    if (current.open && !current.pinned) setOpen(false, { restoreFocus: false });
  }, [setOpen]);

  return { drawer, narrow, workbenchRef: workbench, toggleRef: toggle, railMainRef: railMain, setOpen, onRailClick, onToggleClick, collapseUnpinned };
}

export type CatalogDrawer = ReturnType<typeof useCatalogDrawer>;
