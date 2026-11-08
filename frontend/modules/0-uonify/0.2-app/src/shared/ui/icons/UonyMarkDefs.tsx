import { UONY_COMPACT_GRADIENT_ID } from './uonyCompact';
import { UONY_MARK_GRADIENT, UONY_MARK_GRADIENT_ID } from './uonyMark';

/**
 * Degradado compartido por todas las marcas de Uony (<Icon name="uony"/> e iconHTML).
 * Se monta una vez en los proveedores de la app. Nunca con display:none: un degradado
 * dentro de un SVG oculto no se pinta en Chrome.
 */
export function UonyMarkDefs() {
  const g = UONY_MARK_GRADIENT;
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        <linearGradient id={UONY_MARK_GRADIENT_ID} gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
          {g.stops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
        </linearGradient>
        <linearGradient id={UONY_COMPACT_GRADIENT_ID} gradientUnits="userSpaceOnUse" x1="37" y1="3" x2="1" y2="25">
          {g.stops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
        </linearGradient>
      </defs>
    </svg>
  );
}
