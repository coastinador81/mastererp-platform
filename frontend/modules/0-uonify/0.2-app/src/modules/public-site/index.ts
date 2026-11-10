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

/**
 * Pie global de Uonify, idéntico en todas las páginas y también con sesión (nunca se oculta):
 * Partners y Clientes; «Términos y condiciones», el globo «Idioma y accesibilidad» y «Ayuda».
 * Trae su propia hoja de estilos; una sola instancia por página: `<SiteFooter />`.
 * `<SiteFooterFrame>` monta una pantalla completa con el pie al final (pantallas de acceso).
 */
export { SiteFooter } from './components/footer/SiteFooter';
export { SiteFooterFrame } from './components/footer/SiteFooterFrame';

/**
 * Cabecera de las páginas públicas (todas menos la portada): logo, menú comercial en dos filas,
 * acceso y botón de servicios; trae su propia hoja. La usan las interiores, el centro legal y el
 * centro de ayuda: `<PageHeader loginLabel="Tu espacio Uonify" />` (sin `current` si la página no
 * está en el menú). La página monta también `<AuthDialogs/>` (módulo auth): el acceso los abre.
 */
export { PageHeader } from './components/common/PageHeader';
