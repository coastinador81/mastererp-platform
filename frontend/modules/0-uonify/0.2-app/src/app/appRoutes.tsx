import { AuthDialogs, ConversationActivationGate } from '@/modules/auth';
import { WorkspaceAccessGate } from '@/modules/billing';
import { Navigate, type RouteObject } from 'react-router';
import { topLevelRoutes, workspaceChildRoutes, WORKSPACE_ROUTE_ID } from '@/app/routeRegistry';

// El espacio de trabajo (id «workspace») recibe como hijas las rutas que los
// demás módulos declaran en workspaceRoutes.
function compose(routes: RouteObject[]): RouteObject[] {
  return routes.map((route): RouteObject => {
    if (route.id !== WORKSPACE_ROUTE_ID || route.index) return route;
    return { ...route, element: <><AuthDialogs /><ConversationActivationGate><WorkspaceAccessGate>{route.element}</WorkspaceAccessGate></ConversationActivationGate></>, children: [...(route.children ?? []), ...workspaceChildRoutes] };
  });
}

/**
 * Árbol completo de rutas de la aplicación. Lo usan el router del navegador y las
 * pruebas de humo (con un router de memoria), así ambos pintan exactamente lo mismo.
 */
export const appRoutes: RouteObject[] = [
  ...compose(topLevelRoutes),
  { path: '*', element: <Navigate to="/" replace /> },
];
