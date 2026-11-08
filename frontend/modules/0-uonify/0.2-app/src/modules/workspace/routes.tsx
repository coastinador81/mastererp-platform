import { Navigate, type RouteObject } from 'react-router';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { NexusChannelView, NexusView, ServiceView } from './components/views/ServiceViews';
import { WorkspaceHome } from './components/views/WorkspaceHome';
import { NEXUS_CHANNELS, WORKSPACE_VIEW_SERVICES } from './model/services';

/**
 * Espacio de trabajo (id «workspace», /espacio). El router le añade como hijas las
 * rutas que declaran otros módulos en `workspaceRoutes` (p. ej. catalog:
 * /espacio/producto…), que se pintan en su <Outlet/>.
 *
 *   /espacio                   lienzo en blanco o conversación
 *   /espacio/<servicio>        ERP, Analítica, Captura y auditoría, Agentes, Academy, Logística, Fábrica
 *   /espacio/nexus[/<canal>]   Nexus y la conexión de Amazon o Shopify
 */
export const routes: RouteObject[] = [
  {
    id: 'workspace',
    path: '/espacio',
    element: <WorkspaceLayout />,
    children: [
      { index: true, element: <WorkspaceHome /> },
      ...WORKSPACE_VIEW_SERVICES.filter(service => service !== 'nexus').map(service => ({ path: service, element: <ServiceView service={service} /> })),
      { path: 'nexus', element: <NexusView /> },
      ...NEXUS_CHANNELS.map(channel => ({ path: `nexus/${channel}`, element: <NexusChannelView key={channel} channel={channel} /> })),
      // Una dirección desconocida del espacio vuelve al lienzo en blanco.
      { path: '*', element: <Navigate to="/espacio" replace /> },
    ],
  },
];
