import { absoluteUrl, type SeoEnv } from './env';
import { escapeHtml } from './head';
import { AI_CRAWLERS, PRIVATE_PATHS } from './site';

/**
 * robots.txt según la compilación:
 * - hasta el lanzamiento, «Disallow: /» para todos (nadie rastrea la web);
 * - en el lanzamiento (VITE_INDEXING=true), todo abierto salvo las zonas privadas,
 *   también para los rastreadores de IA, y el enlace al sitemap.
 */
export function buildRobotsTxt(env: SeoEnv): string {
  if (!env.indexing) {
    return [
      '# Uonify todavía no se ha lanzado: la web no se indexa.',
      '# En el lanzamiento se compila con VITE_INDEXING=true y este archivo se abre.',
      'User-agent: *',
      'Disallow: /',
      '',
    ].join('\n');
  }
  return [
    '# Uonify: la web pública se puede rastrear, también para buscadores de IA.',
    'User-agent: *',
    ...AI_CRAWLERS.map(agent => `User-agent: ${agent}`),
    'Allow: /',
    ...PRIVATE_PATHS.map(path => `Disallow: ${path}`),
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml', env)}`,
    '',
  ].join('\n');
}

/** Fecha del sitemap (AAAA-MM-DD). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Orden estable: la portada primero y después por ruta. */
function sortPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b, 'es')));
}

/** sitemap.xml de las páginas prerenderizadas. Se genera en cada compilación; no se envía a nadie. */
export function buildSitemapXml(paths: readonly string[], env: SeoEnv, lastModified: Date): string {
  const lastmod = isoDate(lastModified);
  const urls = sortPaths(paths).map(path => [
    '  <url>',
    `    <loc>${escapeHtml(absoluteUrl(path, env))}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    '  </url>',
  ].join('\n'));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}
