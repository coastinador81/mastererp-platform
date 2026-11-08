import type { IconName } from '@/shared/ui';
import type { AdminSection } from '../../model/permissions';

/** Secciones del panel en el orden del menú (rutas bajo /admin). */
export interface AdminNavItem {
  section: AdminSection;
  label: string;
  path: string;
  icon: IconName;
}

export const ADMIN_BASE = '/admin';

export const ADMIN_NAV: AdminNavItem[] = [
  { section: 'resumen', label: 'Resumen', path: ADMIN_BASE, icon: 'adm-dashboard' },
  { section: 'clientes', label: 'Clientes', path: `${ADMIN_BASE}/clientes`, icon: 'adm-users' },
  { section: 'planes', label: 'Planes y precios', path: `${ADMIN_BASE}/planes`, icon: 'tag' },
  { section: 'proveedores', label: 'Proveedores de IA', path: `${ADMIN_BASE}/proveedores`, icon: 'adm-cpu' },
  { section: 'soporte', label: 'Soporte', path: `${ADMIN_BASE}/soporte`, icon: 'adm-life-buoy' },
  { section: 'articulos', label: 'Artículos de ayuda', path: `${ADMIN_BASE}/articulos`, icon: 'adm-book' },
  { section: 'facturacion', label: 'Facturación', path: `${ADMIN_BASE}/facturacion`, icon: 'adm-receipt' },
  { section: 'auditoria', label: 'Auditoría', path: `${ADMIN_BASE}/auditoria`, icon: 'adm-history' },
];

/** Sección de una ruta (/admin/clientes/acc_1 → clientes). */
export function sectionOf(pathname: string): AdminSection {
  const segment = pathname.slice(ADMIN_BASE.length).split('/').filter(Boolean)[0];
  return ADMIN_NAV.find(item => item.path === `${ADMIN_BASE}/${segment}`)?.section ?? 'resumen';
}
