/**
 * Navegación desde los diálogos de facturación, que se pintan fuera del router
 * (<PaywallHost/> vive en AppProviders). Se apunta la entrada con el formato del
 * historial de React Router (idx) y se avisa con «popstate», que el router escucha:
 * cambia de vista sin recargar la página.
 */
export function goTo(path: string): void {
  if (typeof window === 'undefined') return;
  const state = (window.history.state ?? {}) as { idx?: unknown };
  const idx = typeof state.idx === 'number' ? state.idx + 1 : 0;
  window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
}
