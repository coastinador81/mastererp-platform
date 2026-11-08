/**
 * Corte óptico de controles: caja 38 × 28 y dibujo 36 × 22.
 * Proporción próxima al maestro ON, anillo de 4 px y verticales de la N
 * en x=33/37. Los arcos comparten centro y enlazan tangencialmente la diagonal.
 * Mantener este tamaño mínimo y espacio alrededor; no comprimir en botones de 32 px.
 */
export const UONY_COMPACT_GRADIENT_ID = 'uony-compact-gradient';
export const UONY_COMPACT_PATH =
  'M18.862589 5.403206L33 16.688721V3H37V25L16.367102 8.529313A7 7 0 1 0 18.92026 12.946413L22.882932 15.600562A11 11 0 1 1 18.862589 5.403206Z';
export const UONY_COMPACT_MARKUP =
  `<path stroke="none" style="fill:var(--uony-fill,url(#${UONY_COMPACT_GRADIENT_ID}))" d="${UONY_COMPACT_PATH}"/>`;
