import type { RouteObject } from 'react-router';

export const routes: RouteObject[] = [];

/**
 * Servicio Agentes dentro del espacio de trabajo (hijas de /espacio). Una sola vista para
 * todas las rutas, así abrir un apartado o una ficha no vuelve a montar el panel:
 *   /espacio/agentes                         menú de Agentes y conversación
 *   /espacio/agentes/<apartado>              apartado del menú
 *   /espacio/agentes/<apartado>/<agente>     ficha del agente
 *   /espacio/agentes/crear                   asistente «Crear agente»
 */
export const workspaceRoutes: RouteObject[] = [
  {
    id: 'agentes',
    path: 'agentes',
    HydrateFallback: () => <p className="product-pim-loading" role="status">Cargando…</p>,
    lazy: async () => ({ Component: (await import('./components/AgentsWorkspace')).AgentsWorkspace }),
    children: [
      { index: true, element: null },
      { path: ':seccion', element: null },
      { path: ':seccion/:agente', element: null },
    ],
  },
];
