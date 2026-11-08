import { WORKSPACE_PATH } from './services';

/**
 * Páginas del espacio que no son servicios: Configuración (módulo settings) y la
 * facturación (módulo billing, si la necesita). Se pintan a todo el ancho bajo la
 * cabecera, sin conversación ni compositor, y sobreviven a una recarga (son enlaces
 * que se comparten desde avisos y correos), a diferencia del lienzo y los servicios.
 */
export interface WorkspacePage {
  id: string;
  name: string;
}

const PAGES: Record<string, string> = {
  configuracion: 'Configuración',
  facturacion: 'Facturación',
};

export function workspacePageOf(pathname: string): WorkspacePage | null {
  const clean = pathname.replace(/\/+$/, '');
  if (!clean.startsWith(`${WORKSPACE_PATH}/`)) return null;
  const id = clean.slice(WORKSPACE_PATH.length + 1).split('/')[0];
  return Object.hasOwn(PAGES, id) ? { id, name: PAGES[id] } : null;
}
