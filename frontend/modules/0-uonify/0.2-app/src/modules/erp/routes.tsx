import type { RouteObject } from 'react-router';

/** Sin rutas propias fuera del espacio de trabajo: el retorno de MasterERP lo atiende el servidor. */
export const routes: RouteObject[] = [];

/**
 * Servicio ERP · Finanzas dentro del espacio de trabajo (hijas de /espacio). Una sola
 * vista para todas las rutas, así abrir un apartado o una ficha no vuelve a montar el panel:
 *   /espacio/erp                                   menú de Finanzas y conversación centrada
 *   /espacio/erp/<apartado>                        lista del apartado
 *   /espacio/erp/<apartado>/<referencia>           ficha
 * Se carga aparte. En dev.uonify.com los apartados con API piden la cuenta del ERP
 * conectada; Resumen y Sugerencias son vistas de diseño, como en el desarrollo del equipo.
 */
export const workspaceRoutes: RouteObject[] = [
  {
    id: 'erp',
    path: 'erp',
    // Mientras llega el módulo, el mismo aviso de carga que la ficha de Producto.
    HydrateFallback: () => <p className="product-pim-loading" role="status">Cargando…</p>,
    lazy: async () => ({ Component: (await import('./components/FinanceWorkspace')).FinanceWorkspace }),
    children: [
      { index: true, element: null },
      { path: ':apartado', element: null },
      { path: ':apartado/:referencia', element: null },
    ],
  },
];
