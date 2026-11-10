import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import {
  WIDE_SCREEN_QUERY,
  applyDrawer,
  defaultLayout,
  hasEditingFocus,
  isNarrowWidth,
  layoutForView,
  layoutOnNarrow,
  toggleFromHeader,
  toggleFromRail,
  type DrawerState,
} from '@/modules/catalog';
import { useFinanceKeyboard } from './useFinanceKeyboard';

export const FINANCE_DRAWER_ID = 'finance-drawer';
/** Valor de data-product-sidebar del panel de Finanzas (Escape mira dónde está el foco). */
export const FINANCE_SIDEBAR = 'finanzas';

interface SetOptions {
  trigger?: HTMLElement | null;
  restoreFocus?: boolean;
}

const wideScreen = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_SCREEN_QUERY).matches;
const usable = (element: HTMLElement | null): element is HTMLElement =>
  Boolean(element?.isConnected && !element.closest('[inert]') && element.getClientRects().length > 0);

/**
 * Panel lateral de Finanzas con las MISMAS reglas que el catálogo de Producto
 * (catalog/model/layout.ts y catalog/hooks/useCatalogDrawer.ts): entra abierta y fijada
 * si la columna del módulo es ancha, se pliega al abrir una compra en una columna
 * estrecha y vuelve a abrirse fijada al cerrarla. El estado es propio de Finanzas.
 */
export function useFinanceDrawer(sheet: string, hasSheet: boolean) {
  const [drawer, setState] = useState<DrawerState>({ open: false, pinned: false });
  const current = useRef(drawer);
  const setDrawer = useCallback((next: DrawerState) => {
    current.current = next;
    setState(next);
  }, []);
  const workbench = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const railMain = useRef<HTMLButtonElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const lastSheet = useRef<string | null>(null);

  const measure = useCallback(() => {
    const element = workbench.current;
    return element ? isNarrowWidth(element.clientWidth) : false;
  }, []);
  const subscribeWidth = useCallback((notify: () => void) => {
    const element = workbench.current;
    if (!element || typeof ResizeObserver === 'undefined') return () => {};
    const observer = new ResizeObserver(notify);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const narrow = useSyncExternalStore(subscribeWidth, measure, () => false);

  // Al entrar en Finanzas y al abrir o cerrar una compra (antes de pintar).
  useLayoutEffect(() => {
    const entering = lastSheet.current === null;
    const base = entering ? defaultLayout(current.current, wideScreen()) : current.current;
    const leavingSheet = !entering && lastSheet.current !== 'none' && !hasSheet;
    setDrawer(layoutForView(base, { hasSheet, entering, leavingSheet, narrow: measure() }));
    lastSheet.current = sheet;
  }, [sheet, hasSheet, measure, setDrawer]);

  // Si la columna se estrecha (ventana o conversación al lado), la lista deja de estar fijada.
  useEffect(() => {
    const element = workbench.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    let wasNarrow = measure();
    const observer = new ResizeObserver(() => {
      const now = measure();
      const crossed = now && !wasNarrow;
      wasNarrow = now;
      if (crossed) setDrawer(layoutOnNarrow(current.current, hasEditingFocus(element.querySelector(`#${FINANCE_DRAWER_ID}`))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, setDrawer]);

  const apply = useCallback((next: DrawerState, { trigger = null, restoreFocus = true }: SetOptions = {}) => {
    if (next.open && trigger) origin.current = trigger;
    const panel = workbench.current?.querySelector(`#${FINANCE_DRAWER_ID}`);
    const focusWasInside = Boolean(panel?.contains(document.activeElement));
    flushSync(() => setDrawer(next));
    if (next.open) {
      toggle.current?.focus({ preventScroll: true });
      return;
    }
    if (!restoreFocus && !focusWasInside) return;
    // El botón de la cabecera se oculta al plegar: el foco vuelve al icono del raíl.
    const back = origin.current;
    (usable(back) ? back : railMain.current)?.focus({ preventScroll: true });
  }, [setDrawer]);

  const setOpen = useCallback((open: boolean, options?: SetOptions) => {
    apply(applyDrawer(current.current, open, measure()), options);
  }, [apply, measure]);
  useFinanceKeyboard(FINANCE_SIDEBAR, () => current.current, setOpen);

  const onRailClick = useCallback((trigger: HTMLElement) => {
    apply(toggleFromRail(current.current, measure(), true), { trigger });
  }, [apply, measure]);

  const onToggleClick = useCallback((trigger: HTMLElement) => {
    apply(toggleFromHeader(current.current, measure()), { trigger });
  }, [apply, measure]);

  /** Un clic o el foco en el centro pliegan una lista abierta sin fijar. */
  const collapseUnpinned = useCallback(() => {
    if (current.current.open && !current.current.pinned) setOpen(false, { restoreFocus: false });
  }, [setOpen]);

  /** Al abrir una compra desde la lista, una lista sin fijar se pliega (como el catálogo). */
  const foldUnpinned = useCallback(() => {
    if (!current.current.pinned) setDrawer({ open: false, pinned: false });
  }, [setDrawer]);

  return { drawer, narrow, workbenchRef: workbench, toggleRef: toggle, railMainRef: railMain, setOpen, onRailClick, onToggleClick, collapseUnpinned, foldUnpinned };
}
