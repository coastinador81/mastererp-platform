/**
 * Entrada del prerender (compilación SSR de Vite). La usa scripts/prerender.mjs
 * después de `vite build`: pinta cada ruta pública con el árbol de rutas real de la
 * aplicación y escribe el HTML estático, robots.txt y sitemap.xml.
 *   npm run build   → tsc + vite build + (postbuild) prerender
 * No forma parte del paquete del navegador.
 */
import { appRoutes } from '@/app/appRoutes';
import { HELP_PUBLIC_PATHS } from '@/modules/help';
import { PUBLIC_PATHS } from '../model/views';
import { renderRoute, type RenderedPage } from './render';

export { SEO_ENV } from '../model/seo/env';
export { buildRobotsTxt, buildSitemapXml } from '../model/seo/crawl';
export { buildDocument, outputFileFor } from './document';
export type { RenderedPage } from './render';

/** Rutas que se prerenderizan: la web pública y las del centro de ayuda (módulo help). */
export const PRERENDER_PATHS: readonly string[] = [...new Set([...PUBLIC_PATHS, ...HELP_PUBLIC_PATHS])];

export function renderPage(path: string): Promise<RenderedPage> {
  return renderRoute(appRoutes, path);
}
