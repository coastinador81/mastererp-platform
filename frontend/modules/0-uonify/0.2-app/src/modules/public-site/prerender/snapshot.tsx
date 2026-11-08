import { SHELL_HEAD_TAGS } from '../model/seo/head';
import { applyHead } from '../hooks/headDom';
import { normalizePath, PRERENDER_ATTR, PRERENDER_STYLE_ATTR } from './markers';

/**
 * Paso del HTML prerenderizado a la aplicación sin parpadeo. React vacía #root en su
 * primer pintado y, mientras llega el trozo de la vista (ruta diferida), el router
 * pinta HydrateFallback. Aquí se guarda el HTML estático antes de que React arranque
 * (este módulo se evalúa al importar las rutas) y PrerenderFallback lo vuelve a pintar
 * tal cual hasta que la vista real lo sustituye.
 */
let snapshotHtml = '';
let landingPath: string | null = null;

const currentPath = (doc: Document) => normalizePath(doc.defaultView?.location.pathname ?? '/');

export function capturePrerender(doc: Document | null = typeof document === 'undefined' ? null : document): void {
  const root = doc?.getElementById('root');
  const prerendered = root?.getAttribute(PRERENDER_ATTR);
  if (!doc || !root || prerendered == null) return;
  root.removeAttribute(PRERENDER_ATTR);
  if (prerendered === currentPath(doc)) {
    snapshotHtml = root.innerHTML;
    landingPath = prerendered;
    return;
  }
  // HTML de otra ruta (p. ej. un alojamiento que sirve la portada para /espacio):
  // se descarta todo lo del prerender y la aplicación arranca limpia.
  root.replaceChildren();
  doc.querySelectorAll(`[${PRERENDER_STYLE_ATTR}]`).forEach(node => node.remove());
  doc.body.className = '';
  applyHead(SHELL_HEAD_TAGS, doc);
}

capturePrerender();

/** HydrateFallback de la web pública: el HTML prerenderizado, o nada. */
export function PrerenderFallback() {
  if (!snapshotHtml) return null;
  return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: snapshotHtml }} />;
}

/** ¿Es la primera vista tras cargar su HTML prerenderizado? (no reinicia el scroll ni el <body>). */
export function isPrerenderLanding(pathname: string): boolean {
  return landingPath !== null && landingPath === normalizePath(pathname);
}

/** La vista real ya está pintada: el HTML guardado deja de hacer falta. */
export function endPrerenderLanding(): void {
  landingPath = null;
  snapshotHtml = '';
}
