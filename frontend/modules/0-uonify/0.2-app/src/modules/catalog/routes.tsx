import type { RouteObject } from 'react-router';
import { ProductWorkspace } from './components/ProductWorkspace';

/**
 * Servicio Producto dentro del espacio de trabajo (hijas de /espacio). Una sola vista
 * (ProductWorkspace) para las tres rutas, así cambiar de producto o de pestaña no
 * vuelve a montar el catálogo:
 *   /espacio/producto               catálogo y conversación centrada
 *   /espacio/producto/:sku          ficha (Atributos); «nuevo» = Nuevo Producto
 *   /espacio/producto/:sku/:tab     ficha en otra pestaña
 */
export const workspaceRoutes: RouteObject[] = [
  {
    id: 'producto',
    path: 'producto',
    element: <ProductWorkspace />,
    children: [
      { index: true, element: null },
      { path: 'incidencias/todas', element: null },
      { path: ':sku', element: null },
      { path: ':sku/:tab', element: null },
    ],
  },
];
