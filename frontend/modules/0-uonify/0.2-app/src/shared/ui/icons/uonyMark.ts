/**
 * Maestro vectorial del isotipo ON de Uony. Arcos circulares y un único contorno,
 * sin mapas de bits. `scripts/export-uony-mark.mjs` genera los SVG de distribución.
 * La caja conserva la proporción natural y deja un margen óptico de un punto.
 */
export const UONY_MARK_BOX_WIDTH = 40;
export const UONY_MARK_GRADIENT_ID = 'uony-mark-gradient';

export const UONY_MARK_PATH =
  'M133.709 17.292L246 103.95V0H275.75V165.75L115.535 41.161A53 53 0 1 0 134.949 72.5L165.015 95.75A83 83 0 1 1 133.709 17.292Z';

/** El azul termina en la N y el aqua en la O, dentro de las coordenadas del dibujo. */
export const UONY_MARK_GRADIENT = {
  x1: 246,
  y1: 0,
  x2: 30,
  y2: 166,
  stops: [
    [0, '#0473E6'], [0.125, '#0374E9'], [0.25, '#0577E7'], [0.375, '#067CEA'], [0.5, '#0D87E4'],
    [0.625, '#29AEC9'], [0.75, '#2EB7C6'], [0.875, '#31BBC5'], [1, '#32BCC3'],
  ] as const,
};

/** 166 unidades de alto → 22 puntos; centrado en 40 × 24 sin estirar. */
export const UONY_MARK_TRANSFORM = 'translate(1.72741 1) scale(0.13253012)';
export const UONY_MARK_MARKUP =
  `<g transform="${UONY_MARK_TRANSFORM}" stroke="none">` +
  `<path style="fill:var(--uony-fill,url(#${UONY_MARK_GRADIENT_ID}))" d="${UONY_MARK_PATH}"/></g>`;
