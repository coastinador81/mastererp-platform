import type { RouteObject } from 'react-router';
import { SettingsPage } from './components/SettingsPage';

/**
 * Configuración dentro del espacio de trabajo (hija de /espacio):
 *   /espacio/configuracion              lista de secciones (móvil) o Cuenta (escritorio)
 *   /espacio/configuracion/:section     cuenta, seguridad, conexiones, uso, plan,
 *                                       usuarios, gpsr, privacidad o ayuda
 * Una sección desconocida vuelve a /espacio/configuracion.
 */
export const workspaceRoutes: RouteObject[] = [
  { id: 'configuracion', path: 'configuracion/:section?', element: <SettingsPage /> },
];
