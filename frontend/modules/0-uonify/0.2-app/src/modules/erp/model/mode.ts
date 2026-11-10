import type { SpaceContext } from '../api/finance';
import { findApartado } from './menu';
import { realApartado } from './real';

/**
 * Cómo se abre cada apartado, con la regla del menú del equipo en desarrollo
 * (FinanceNavigation.jsx:19 y :27): con la cuenta del ERP conectada, los apartados con API
 * van con datos reales si el contexto trae su permiso («Sin acceso» si no); Resumen y
 * Sugerencias siguen siendo vistas de diseño con datos de ejemplo. Sin conexión, la vista
 * local de ejemplo de siempre. El contexto no concede permisos: la API vuelve a decidir.
 */
export type ApartadoMode = 'real' | 'demo' | 'sin-acceso' | null;

export interface Connection {
  /** Conectado con espacio y empresa elegidos (readyScope). */
  ready: boolean;
  context: SpaceContext | null;
  /** Vista local con datos de ejemplo (VITE_USE_MOCKS); en dev.uonify.com, false. */
  local: boolean;
}

export function modeOf(route: string | null | undefined, connection: Connection): ApartadoMode {
  const real = realApartado(route);
  if (real && connection.ready) return connection.context?.permissions.includes(real.permission) ? 'real' : 'sin-acceso';
  // En dev.uonify.com un apartado con API solo se abre con la cuenta conectada (nada de ejemplo en su lugar).
  if (real && !connection.local) return 'sin-acceso';
  return findApartado(route ?? undefined)?.item.status === 'uonify' ? 'demo' : null;
}
