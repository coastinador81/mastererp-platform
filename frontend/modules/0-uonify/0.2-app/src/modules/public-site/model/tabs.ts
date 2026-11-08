/**
 * Teclado de las pestañas del PROTO (ficha de ejemplo, galería, recorrido):
 * flechas izquierda/derecha en bucle, Inicio y Fin. Devuelve el índice destino
 * o `undefined` si la tecla no mueve el foco.
 */
export function nextTabIndex(key: string, index: number, length: number): number | undefined {
  if (length <= 0) return undefined;
  if (key === 'ArrowRight') return (index + 1) % length;
  if (key === 'ArrowLeft') return (index + length - 1) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return undefined;
}
