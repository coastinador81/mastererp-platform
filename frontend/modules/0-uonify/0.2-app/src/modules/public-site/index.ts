/**
 * Web pública de Uonify (portada, Productos, Cómo funciona, Para empresas, Sobre Uonify,
 * Novedades y las páginas legales). Sus rutas se registran solas desde routes.tsx.
 * Otros módulos pueden enlazar a estas rutas con PATHS (p. ej. PATHS.privacidad).
 * Al compilar se prerenderiza a HTML estático con su cabecera SEO (README.md).
 */
export { PATHS, PUBLIC_VIEWS, PUBLIC_PATHS, WORKSPACE_PATH, type PublicViewKey, type PublicViewMeta } from './model/views';
export { toAppHref } from './model/links';

/**
 * Cabecera SEO de una página pública (título, descripción, noindex hasta el lanzamiento,
 * canónico, Open Graph y JSON-LD). Para páginas públicas de otros módulos, como el centro
 * de ayuda: `useSeoHead({ path: '/ayuda/mi-articulo', title, description, breadcrumbs, faq })`.
 * El prerender la recoge y la escribe en el HTML estático.
 */
export { useSeoHead } from './hooks/useSeoHead';
export type { SeoPage, SeoCrumb, SeoQuestion, JsonLdNode } from './model/seo/types';

export { useViewStyles } from './hooks/useViewStyles';
