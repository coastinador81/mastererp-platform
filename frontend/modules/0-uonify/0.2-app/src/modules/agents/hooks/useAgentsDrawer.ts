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

export const AGENTS_DRAWER_ID = 'agents-drawer';
export const AGENTS_SIDEBAR = 'agentes';

const wideScreen = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_SCREEN_QUERY).matches;
const usable = (element: HTMLElement | null): element is HTMLElement =>
  Boolean(element?.isConnected && !element.closest('[inert]') && element.getClientRects().length > 0);

/**
 * Panel lateral de Agentes con las mismas reglas que Producto y ERP · Finanzas
 * (catalog/model/layout.ts): entra abierto y fijado en columnas anchas, se pliega al abrir
 * una ficha en una columna estrecha y vuelve al cerrarla. Escape lo pliega si está suelto.
 */
export function useAgentsDrawer(sheet: string, hasSheet: boolean) {
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

  useLayoutEffect(() => {
    const entering = lastSheet.current === null;
    const base = entering ? defaultLayout(current.current, wideScreen()) : current.current;
    const leavingSheet = !entering && lastSheet.current !== 'none' && !hasSheet;
    setDrawer(layoutForView(base, { hasSheet, entering, leavingSheet, narrow: measure() }));
    lastSheet.current = sheet;
  }, [sheet, hasSheet, measure, setDrawer]);

  useEffect(() => {
    const element = workbench.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    let wasNarrow = measure();
    const observer = new ResizeObserver(() => {
      const now = measure();
      const crossed = now && !wasNarrow;
      wasNarrow = now;
      if (crossed) setDrawer(layoutOnNarrow(current.current, hasEditingFocus(element.querySelector(`#${AGENTS_DRAWER_ID}`))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, setDrawer]);

  const apply = useCallback((next: DrawerState, trigger: HTMLElement | null = null, restoreFocus = true) => {
    if (next.open && trigger) origin.current = trigger;
    const panel = workbench.current?.querySelector(`#${AGENTS_DRAWER_ID}`);
    const focusWasInside = Boolean(panel?.contains(document.activeElement));
    flushSync(() => setDrawer(next));
    if (next.open) {
      toggle.current?.focus({ preventScroll: true });
      return;
    }
    if (!restoreFocus && !focusWasInside) return;
    const back = origin.current;
    (usable(back) ? back : railMain.current)?.focus({ preventScroll: true });
  }, [setDrawer]);

  // Escape pliega el panel suelto (o el fijado con el foco dentro), si no hay un diálogo abierto.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      const focusedSide = document.activeElement?.closest('[data-product-sidebar]')?.getAttribute('data-product-sidebar');
      const { open, pinned } = current.current;
      if (!open || (pinned && focusedSide !== AGENTS_SIDEBAR)) return;
      event.preventDefault();
      apply(applyDrawer(current.current, false, measure()), null, focusedSide === AGENTS_SIDEBAR);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [apply, measure]);

  const onRailClick = useCallback((trigger: HTMLElement) => apply(toggleFromRail(current.current, measure(), true), trigger), [apply, measure]);
  const onToggleClick = useCallback((trigger: HTMLElement) => apply(toggleFromHeader(current.current, measure()), trigger), [apply, measure]);
  const collapseUnpinned = useCallback(() => {
    if (current.current.open && !current.current.pinned) apply(applyDrawer(current.current, false, measure()), null, false);
  }, [apply, measure]);
  const foldUnpinned = useCallback(() => {
    if (!current.current.pinned) setDrawer({ open: false, pinned: false });
  }, [setDrawer]);

  return { drawer, narrow, workbenchRef: workbench, toggleRef: toggle, railMainRef: railMain, onRailClick, onToggleClick, collapseUnpinned, foldUnpinned };
}
