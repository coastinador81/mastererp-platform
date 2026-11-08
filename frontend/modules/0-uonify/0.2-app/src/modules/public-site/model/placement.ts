/**
 * Colocación de los menús del compositor (placePicker y el menú «+» de
 * composer-tools.js). Funciones puras: reciben medidas y devuelven la posición.
 */
export interface PickerPlacementInput {
  /** Borde superior e inferior del selector de IA en la ventana. */
  pickerTop: number;
  pickerBottom: number;
  viewportHeight: number;
  /** El compositor está en la portada (tiene más aire arriba y prefiere abrirse abajo). */
  onLanding: boolean;
  /** Altura deseada: 470 para modelos, 260 para esfuerzo. */
  desired: number;
  /** Altura real del contenido del menú. */
  contentHeight: number;
}

export interface PickerPlacement { below: boolean; maxHeight: number }

export function pickerPlacement(input: PickerPlacementInput): PickerPlacement {
  const above = Math.max(150, input.pickerTop - (input.onLanding ? 30 : 84));
  const below = Math.max(150, input.viewportHeight - input.pickerBottom - 30);
  const landingHasRoomBelow = input.onLanding && below >= 220;
  const placeBelow = landingHasRoomBelow || (above < input.contentHeight && below > above);
  return { below: placeBelow, maxHeight: Math.min(input.desired, placeBelow ? below : above) };
}

/** Desplazamiento horizontal para que el menú no se salga del compositor ni de la ventana. */
export function horizontalShift(menu: { left: number; right: number }, box: { left: number; right: number }, viewportWidth: number): number {
  const left = Math.max(8, box.left);
  const right = Math.min(viewportWidth - 8, box.right);
  if (menu.left < left) return left - menu.left;
  if (menu.right > right) return right - menu.right;
  return 0;
}

/** Menú «+»: justo encima de su botón y dentro del compositor. */
export function moreMenuPosition(
  box: { left: number; bottom: number; width: number },
  button: { left: number; top: number },
  menuWidth: number,
): { left: number; bottom: number } {
  return {
    left: Math.round(Math.max(0, Math.min(button.left - box.left, box.width - menuWidth))),
    bottom: Math.round(box.bottom - button.top + 6),
  };
}
