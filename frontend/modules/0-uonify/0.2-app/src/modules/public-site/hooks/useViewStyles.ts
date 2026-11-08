import { useLayoutEffect } from 'react';
import { usePrerenderCollector } from '../prerender/collector';
import { PRERENDER_STYLE_ATTR } from '../prerender/markers';

/**
 * Inyecta las hojas de una vista pública mientras está montada y las quita al salir,
 * igual que unified.js cargaba solo los estilos de la vista activa. Así las reglas
 * globales del PROTO (`:root`, `body`, `.header`…) no afectan al espacio de trabajo
 * ni a otras vistas. Se aplica antes de pintar (useLayoutEffect): no hay parpadeo.
 * `sheets` debe ser una constante de módulo (texto CSS importado con `?inline`).
 * Al compilar, el prerender las recoge y el HTML estático las enlaza; al montar la
 * vista, esas copias enlazadas se quitan porque la vista ya trae las suyas.
 */
export function useViewStyles(view: string, sheets: readonly string[]): void {
  usePrerenderCollector()?.addSheets(view, sheets);
  useLayoutEffect(() => {
    const nodes = sheets.map(css => {
      const style = document.createElement('style');
      style.dataset.uonViewStyle = view;
      style.textContent = css;
      document.head.append(style);
      return style;
    });
    document.querySelectorAll(`[${PRERENDER_STYLE_ATTR}]`).forEach(node => node.remove());
    return () => nodes.forEach(node => node.remove());
  }, [view, sheets]);
}
