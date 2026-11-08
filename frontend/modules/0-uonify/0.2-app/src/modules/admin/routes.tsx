import { Navigate, type RouteObject } from 'react-router';

/**
 * Panel de administración (/admin/*), con su propia maqueta y su propio acceso (correo
 * @uonify.com + código + verificación en dos pasos). Todo se descarga al entrar, así
 * no pesa en la aplicación de los clientes.
 *
 *   /admin                         Resumen
 *   /admin/clientes[/:customerId]  Clientes y ficha
 *   /admin/planes                  Planes y precios (billing y help)
 *   /admin/proveedores             Proveedores de IA
 *   /admin/soporte[/:ticketId]     Tickets y conversaciones de Uony derivadas (help)
 *   /admin/articulos[/nuevo|/:id]  Artículos de ayuda (help)
 *   /admin/facturacion             Facturas, desistimientos y notas de crédito
 *   /admin/auditoria               Registro de acciones del equipo
 */
function AdminBootFallback() {
  return <p style={{ padding: 24, fontFamily: 'Inter, sans-serif', color: 'var(--muted)' }}>Abriendo el panel…</p>;
}

export const routes: RouteObject[] = [
  {
    path: '/admin',
    HydrateFallback: AdminBootFallback,
    lazy: async () => ({ Component: (await import('./components/AdminApp')).AdminApp }),
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./components/overview/OverviewPage')).OverviewPage }) },
      { path: 'clientes', lazy: async () => ({ Component: (await import('./components/customers/CustomersPage')).CustomersPage }) },
      { path: 'clientes/:customerId', lazy: async () => ({ Component: (await import('./components/customers/CustomerPage')).CustomerPage }) },
      { path: 'planes', lazy: async () => ({ Component: (await import('./components/pricing/PricingPage')).PricingPage }) },
      { path: 'proveedores', lazy: async () => ({ Component: (await import('./components/providers/ProvidersPage')).ProvidersPage }) },
      {
        // Lista y conversación en la misma vista: cambiar de ticket no vuelve a montar la lista.
        path: 'soporte',
        lazy: async () => ({ Component: (await import('./components/support/SupportPage')).SupportPage }),
        children: [
          { index: true, element: null },
          { path: ':ticketId', element: null },
        ],
      },
      { path: 'articulos', lazy: async () => ({ Component: (await import('./components/articles/ArticlesPage')).ArticlesPage }) },
      { path: 'articulos/:articleId', lazy: async () => ({ Component: (await import('./components/articles/ArticleEditorPage')).ArticleEditorPage }) },
      { path: 'facturacion', lazy: async () => ({ Component: (await import('./components/finance/FinancePage')).FinancePage }) },
      { path: 'auditoria', lazy: async () => ({ Component: (await import('./components/audit/AuditPage')).AuditPage }) },
      { path: '*', element: <Navigate to="/admin" replace /> },
    ],
  },
];
