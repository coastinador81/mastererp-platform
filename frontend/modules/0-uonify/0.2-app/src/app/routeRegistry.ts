import type { RouteObject } from 'react-router';

/**
 * Cada módulo declara sus rutas en src/modules/<módulo>/routes.tsx:
 *   export const routes: RouteObject[]            → rutas de primer nivel (web pública, /espacio…)
 *   export const workspaceRoutes: RouteObject[]   → hijas del espacio de trabajo (/espacio/…)
 * No hay que tocar este archivo para añadir un módulo.
 */
export interface ModuleRoutes {
  routes?: RouteObject[];
  workspaceRoutes?: RouteObject[];
}

const manifests = import.meta.glob<ModuleRoutes>('../modules/*/routes.tsx', { eager: true });

export const topLevelRoutes: RouteObject[] = Object.values(manifests).flatMap(m => m.routes ?? []);
export const workspaceChildRoutes: RouteObject[] = Object.values(manifests).flatMap(m => m.workspaceRoutes ?? []);

/** Id de la ruta de primer nivel que pinta el espacio de trabajo (módulo workspace). */
export const WORKSPACE_ROUTE_ID = 'workspace';
