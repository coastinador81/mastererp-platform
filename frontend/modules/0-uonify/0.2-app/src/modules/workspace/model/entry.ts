import { workspacePageOf } from './pages';
import { isServiceId, servicePath, WORKSPACE_PATH } from './services';

/**
 * Reglas de recarga del espacio (CONTINUIDAD-DESARROLLO-UONIFY.md, sección 4, y
 * restauración de app-shell.js): recargar o entrar directamente en el espacio
 * vuelve SIEMPRE al lienzo limpio, como una entrada nueva, aunque la URL fuera la
 * de un servicio o una ficha. Excepción: `?service=<id>` abre ese servicio (enlace
 * profundo del PROTO `index.html?view=espacio&service=…`, aquí /espacio?service=…).
 * Las páginas que no son servicios (Configuración, facturación) se quedan donde están.
 *
 * Devuelve a dónde redirigir en la primera pintura del documento, o null si la
 * URL ya es la correcta.
 */
export function entryRedirect(pathname: string, search: string): string | null {
  const requested = serviceLink(search);
  if (requested) return requested;
  const clean = pathname.replace(/\/+$/, '');
  // El conector local abre Nexus para que el dueño apruebe su propio equipo.
  if (clean === servicePath('nexus') && new URLSearchParams(search).get('blenderPair')) return null;
  if (clean === WORKSPACE_PATH && !search) return null;
  if (workspacePageOf(clean)) return null;
  return WORKSPACE_PATH;
}

/** Enlace profundo `?service=<id>` (también al llegar navegando desde la web pública). */
export function serviceLink(search: string): string | null {
  const requested = new URLSearchParams(search).get('service');
  return isServiceId(requested) ? servicePath(requested) : null;
}

// URL con la que se cargó el documento: si el espacio se pinta por primera vez
// en esa misma URL, es una recarga o una entrada directa (no una navegación
// dentro de la aplicación, que conserva su destino).
const entryUrl = typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}`;
let entryHandled = false;

/** El espacio se pinta en la URL con la que se cargó el documento (y aún no se ha atendido). */
export function isEntryLoad(pathname: string, search: string): boolean {
  return !entryHandled && `${pathname}${search}` === entryUrl;
}

/** La entrada solo se atiende una vez por documento. */
export function markEntryHandled(): void {
  entryHandled = true;
}
