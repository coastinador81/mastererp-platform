import { isPublicViewKey, PUBLIC_VIEWS, WORKSPACE_PATH, type PublicViewKey } from './views';

/**
 * Reescritura de enlaces de unified.js: el prototipo enlazaba `producto.html#catalogo`
 * o `index.html?view=espacio&service=erp` y los convertía en vistas de su documento
 * único. Aquí se traducen a rutas de la aplicación. Sirve para redirigir las URL
 * antiguas (marcadores, enlaces compartidos) y documenta la correspondencia.
 */
const BASE = 'https://uonify.invalid/';

/** Páginas `*.html` del prototipo (todas las vistas menos portada y espacio). */
const LEGACY_PAGES: readonly PublicViewKey[] = ['producto', 'como-funciona', 'para-empresas', 'empresa', 'novedades', 'privacidad', 'terminos'];

/** Nombres de archivo del prototipo que la aplicación redirige (`/producto.html`…). */
export const LEGACY_FILES: readonly string[] = ['index.html', ...LEGACY_PAGES.map(page => `${page}.html`)];

/** Traduce un enlace del PROTO a una ruta de la aplicación; el resto se devuelve igual. */
export function toAppHref(raw: string): string {
  if (!raw || raw.startsWith('#')) return raw;
  let target: URL;
  try { target = new URL(raw, BASE); } catch { return raw; }
  if (target.origin !== new URL(BASE).origin) return raw;
  const localName = target.pathname.replace(/^\/+/, '');
  if (localName === 'index.html' || localName === '') {
    const requested = target.searchParams.get('view');
    if (requested === 'espacio') {
      const service = target.searchParams.get('service');
      return `${WORKSPACE_PATH}${service ? `?service=${encodeURIComponent(service)}` : ''}${target.hash}`;
    }
    // Como unified.js: una vista desconocida (o ninguna) resuelve a la portada.
    const destination = isPublicViewKey(requested) ? requested : 'portada';
    // La vuelta del acceso (`?auth=return`) la gestiona auth en la portada: se conserva.
    const authReturn = destination === 'portada' && target.searchParams.get('auth') === 'return' ? '?auth=return' : '';
    return `${PUBLIC_VIEWS[destination].path}${authReturn}${target.hash}`;
  }
  if (localName.endsWith('.html')) {
    const page = localName.slice(0, -5);
    if ((LEGACY_PAGES as readonly string[]).includes(page)) return `${PUBLIC_VIEWS[page as PublicViewKey].path}${target.hash}`;
  }
  return raw;
}

/** Tipo de destino de un enlace ya traducido: ancla de la misma página, ruta interna o externo. */
export type HrefKind = 'hash' | 'route' | 'external';

export function hrefKind(href: string): HrefKind {
  if (href.startsWith('#')) return 'hash';
  if (href.startsWith('/') && !href.startsWith('//')) return 'route';
  return 'external';
}
