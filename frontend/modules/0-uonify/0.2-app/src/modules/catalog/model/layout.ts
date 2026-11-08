/**
 * Reglas del catálogo lateral (prototipo: app-shell.js, applyDefaultProductLayout,
 * syncProductDrawers, setProductDrawer y los clics en el raíl y en el botón de la
 * cabecera del catálogo). Puras, para probarlas sin DOM.
 */
export interface DrawerState {
  open: boolean;
  pinned: boolean;
}

/** La columna del módulo es estrecha (≤ 760 px): el catálogo no cabe fijado. */
export const NARROW_MODULE_WIDTH = 760;
/** Pantallas anchas (≥ 1200 px) abren la primera vez el catálogo fijado junto a la ficha. */
export const WIDE_SCREEN_QUERY = '(min-width: 1200px)';

export const isNarrowWidth = (width: number): boolean => width <= NARROW_MODULE_WIDTH;

/** Primera vez que se entra en Producto: catálogo | ficha | conversación en pantallas anchas. */
export function defaultLayout(state: DrawerState, wideScreen: boolean): DrawerState {
  return wideScreen ? { open: true, pinned: true } : state;
}

/** Nombre (y title) del botón de la cabecera del catálogo. */
export function drawerToggleLabel({ open, pinned }: DrawerState, narrow: boolean): string {
  if (pinned || (open && narrow)) return 'Replegar catálogo';
  return open ? 'Fijar catálogo' : 'Expandir y fijar catálogo';
}

/** Abre o pliega: una columna estrecha no deja fijar; plegar siempre suelta. */
export function applyDrawer(state: DrawerState, open: boolean, narrow: boolean): DrawerState {
  let pinned = state.pinned;
  if (open && narrow) pinned = false;
  if (!open) pinned = false;
  return { open, pinned };
}

/**
 * Botón de la cabecera del catálogo: abierto (fijado, o sin fijar en una columna
 * estrecha) → plegar; abierto sin fijar en una columna ancha → fijar.
 */
export function toggleFromHeader(state: DrawerState, narrow: boolean): DrawerState {
  if (state.open && (state.pinned || narrow)) return applyDrawer(state, false, narrow);
  return applyDrawer({ ...state, pinned: !narrow }, true, narrow);
}

/**
 * Icono del raíl: abre su panel y lo deja abierto (como una barra lateral de Claude
 * plegada) o lo pliega si ya estaba abierto.
 */
export function toggleFromRail(state: DrawerState, narrow: boolean, fromRail: boolean): DrawerState {
  const open = !state.open;
  const pinned = open && fromRail && !narrow ? true : state.pinned;
  return applyDrawer({ ...state, pinned }, open, narrow);
}

/**
 * Al pintar la vista: una ficha en una columna estrecha pliega un catálogo fijado;
 * entrar en Producto sin ficha, o cerrar una ficha, abre el catálogo fijado (si cabe).
 */
export function layoutForView(state: DrawerState, { hasSheet, entering, leavingSheet, narrow }: {
  hasSheet: boolean;
  entering: boolean;
  leavingSheet: boolean;
  narrow: boolean;
}): DrawerState {
  if (hasSheet && state.pinned && narrow) return { open: false, pinned: false };
  if (!hasSheet && (entering || leavingSheet) && !narrow) return { open: true, pinned: true };
  return state;
}

/** Al cruzar a una columna estrecha, el catálogo deja de estar fijado (y se pliega). */
export function layoutOnNarrow(state: DrawerState, editingInside: boolean): DrawerState {
  if (!state.pinned) return state;
  if (state.open && !editingInside) return { open: false, pinned: false };
  return { ...state, pinned: false };
}
