/** Atributo de #root con la ruta que se prerenderizó en ese HTML («/productos»). */
export const PRERENDER_ATTR = 'data-prerendered';

/** Marca las hojas de la vista enlazadas en el HTML prerenderizado. */
export const PRERENDER_STYLE_ATTR = 'data-uon-prerender-style';

/** Ruta sin barras finales (la portada es «/»): así «/productos/» y «/productos» coinciden. */
export function normalizePath(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}
