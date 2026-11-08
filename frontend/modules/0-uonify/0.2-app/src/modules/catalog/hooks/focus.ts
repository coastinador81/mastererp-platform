/**
 * Foco gestionado del servicio Producto: después de navegar, el destino puede
 * aparecer uno o dos fotogramas más tarde (y un diálogo que se cierra devuelve
 * antes el foco a quien lo abrió), así que se reintenta unos fotogramas.
 */
export function isUsable(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && !element.closest('[inert]') && !element.closest('[hidden]');
}

export function focusWhenReady(find: () => Element | null | undefined, frames = 12): void {
  let left = frames;
  const tick = () => {
    const element = find();
    if (isUsable(element)) {
      element.focus({ preventScroll: true });
      return;
    }
    left -= 1;
    if (left > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Campo en edición dentro de un panel (no se pliega bajo quien escribe). */
export function hasEditingFocus(panel: Element | null | undefined): boolean {
  const active = document.activeElement;
  if (!panel || !active || !panel.contains(active)) return false;
  return active.matches('input, textarea, select, [contenteditable="true"]') || safeMatches(active, ':focus-visible');
}

function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** Consulta de medios segura (jsdom no tiene matchMedia). */
export function mediaMatches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/**
 * Tras cerrar una ficha: el compositor con ratón o teclado; en táctil, el centro,
 * para que el teclado del móvil no tape el catálogo.
 */
export function focusAfterClosingSheet(detail: number | undefined, center: () => Element | null, focusComposer: () => void): void {
  const touch = !mediaMatches('(pointer: fine)') && detail !== 0;
  if (touch) focusWhenReady(center);
  else focusComposer();
}

/** CSS.escape con respaldo (jsdom no siempre lo tiene). */
export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
