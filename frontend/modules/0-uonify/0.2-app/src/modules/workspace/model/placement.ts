/**
 * Colocación de los menús del compositor y del lanzador de servicios
 * (composer-tools.js y app-shell.js). Funciones puras sobre rectángulos para
 * poder probarlas; los componentes aplican el resultado como estilo.
 */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}

/** Panel de uso: justo encima de su botón, alineado a él y dentro del compositor. */
export function usagePanelPosition(form: Box, button: Box, panelWidth: number,
  viewport?: { panelHeight: number; viewportHeight: number }): { left: number; bottom: number } {
  const maxLeft = Math.max(0, form.width - panelWidth);
  let bottom = form.bottom - button.top + 6;
  if (viewport) {
    const above = button.top - 6 - viewport.panelHeight;
    const below = button.bottom + 6;
    // Mantener el mismo panel visible cuando el compositor está centrado en móvil.
    const desired = above < 8 && below + viewport.panelHeight <= viewport.viewportHeight - 8 ? below : above;
    const top = Math.max(8, Math.min(desired, viewport.viewportHeight - viewport.panelHeight - 8));
    bottom = form.bottom - top - viewport.panelHeight;
  }
  return {
    left: Math.round(Math.max(0, Math.min(button.left - form.left - 4, maxLeft))),
    bottom: Math.round(bottom),
  };
}

/** Menú «+»: encima de su botón, como el panel de uso. */
export function moreMenuPosition(form: Box, button: Box, menuWidth: number): { left: number; bottom: number } {
  return {
    left: Math.round(Math.max(0, Math.min(button.left - form.left, form.width - menuWidth))),
    bottom: Math.round(form.bottom - button.top + 6),
  };
}

/**
 * Menús de modelo y esfuerzo: encima del selector si cabe (o debajo si hay más
 * sitio), con la altura limitada al espacio disponible y desplazados para no
 * salirse del compositor ni de la pantalla.
 */
export function pickerPlacement(input: {
  picker: Box;
  form: Box;
  menu: Box;
  viewportHeight: number;
  viewportWidth: number;
  scrollHeight: number;
  desired: number;
  /** El compositor de la portada deja otro margen arriba. */
  landing?: boolean;
}): { below: boolean; maxHeight: number; shift: number } {
  const above = Math.max(150, input.picker.top - (input.landing ? 30 : 84));
  const belowRoom = Math.max(150, input.viewportHeight - input.picker.bottom - 30);
  const landingHasRoomBelow = Boolean(input.landing) && belowRoom >= 220;
  const below = landingHasRoomBelow || (above < input.scrollHeight && belowRoom > above);
  const left = Math.max(8, input.form.left);
  const right = Math.min(input.viewportWidth - 8, input.form.right);
  const shift = input.menu.left < left ? left - input.menu.left : input.menu.right > right ? right - input.menu.right : 0;
  return { below, maxHeight: Math.min(input.desired, below ? belowRoom : above), shift: Math.round(shift) };
}

/** Menú de servicios: su borde derecho bajo el del lanzador, sin salirse por la izquierda. */
export function servicesMenuRight(barRight: number, triggerRight: number, menuWidth: number): number {
  const underLauncher = barRight - triggerRight;
  const keepOnScreen = barRight - menuWidth - 8;
  return Math.round(Math.max(8, Math.min(underLauncher, keepOnScreen)));
}

export function toBox(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width };
}
