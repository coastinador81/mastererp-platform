/**
 * Foco tras volver a pintar (el withFocus del prototipo): cuando el control con
 * el foco desaparece, se lleva al que ocupa su lugar en el siguiente fotograma.
 */
export function focusSoon(find: () => HTMLElement | null | undefined): void {
  const run = () => {
    const target = find();
    if (target && !(target as HTMLButtonElement).disabled) target.focus({ preventScroll: true });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

/** Si el foco se ha perdido (el control que lo tenía ya no está). */
export function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/** Si el foco se pierde, pasa al primer control con data-focus-key del grupo. */
export function rescueFocus(container: HTMLElement | null): void {
  focusSoon(() => (focusLost() ? container?.querySelector<HTMLElement>('[data-focus-key]') : null));
}
