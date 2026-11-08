import type { RouteObject } from 'react-router';
import { LegacyRedirect, PublicLayout } from './components/PublicLayout';
import { LEGACY_FILES } from './model/links';
import { PrerenderFallback } from './prerender/snapshot';

/**
 * Web pública de Uonify. Cada vista se descarga al visitarla (con sus hojas de estilo).
 * Privacidad y Condiciones son públicas en todos los entornos y no piden sesión.
 * Al compilar, todas se prerenderizan a HTML estático (prerender/entry-server.tsx).
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <PublicLayout />,
    // Mientras llega la primera vista se mantiene su HTML prerenderizado; sin él, no se
    // pinta nada (como el PROTO, que esperaba a sus estilos).
    HydrateFallback: PrerenderFallback,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./components/home/HomePage')).HomePage }) },
      { path: 'productos', lazy: async () => ({ Component: (await import('./components/productos/ProductosPage')).ProductosPage }) },
      { path: 'como-funciona', lazy: async () => ({ Component: (await import('./components/como-funciona/ComoFuncionaPage')).ComoFuncionaPage }) },
      { path: 'lo-que-puedes-hacer', lazy: async () => ({ Component: (await import('./components/lo-que-puedes-hacer/LoQuePuedesHacerPage')).LoQuePuedesHacerPage }) },
      { path: 'precios', lazy: async () => ({ Component: (await import('./components/precios/PreciosPage')).PreciosPage }) },
      { path: 'seguridad', lazy: async () => ({ Component: (await import('./components/seguridad/SeguridadPage')).SeguridadPage }) },
      { path: 'para-empresas', lazy: async () => ({ Component: (await import('./components/para-empresas/ParaEmpresasPage')).ParaEmpresasPage }) },
      { path: 'sobre-uonify', lazy: async () => ({ Component: (await import('./components/sobre-uonify/SobreUonifyPage')).SobreUonifyPage }) },
      { path: 'novedades', lazy: async () => ({ Component: (await import('./components/novedades/NovedadesPage')).NovedadesPage }) },
      { path: 'privacidad', lazy: async () => ({ Component: (await import('./components/legal/LegalPage')).PrivacyPage }) },
      { path: 'terminos', lazy: async () => ({ Component: (await import('./components/legal/LegalPage')).TermsPage }) },
      ...LEGACY_FILES.map((file): RouteObject => ({ path: file, element: <LegacyRedirect /> })),
    ],
  },
];
