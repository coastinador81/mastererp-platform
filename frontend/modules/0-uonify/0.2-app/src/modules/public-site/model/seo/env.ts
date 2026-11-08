/**
 * Configuración SEO de cada compilación. Hasta el lanzamiento la web no se indexa:
 * noindex en todas las páginas y robots.txt con «Disallow: /». En el lanzamiento se
 * compila con VITE_INDEXING=true (ver README.md del módulo).
 */
export interface SeoEnv {
  /** Origen público, sin barra final (https://uonify.com). */
  siteUrl: string;
  /** true solo en el lanzamiento. */
  indexing: boolean;
}

export const DEFAULT_SITE_URL = 'https://uonify.com';

interface SeoEnvSource {
  VITE_SITE_URL?: string;
  VITE_INDEXING?: string;
}

/** Quita barras finales y rutas: el canónico se construye siempre sobre el origen. */
export function normalizeSiteUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_SITE_URL;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function readSeoEnv(source: SeoEnvSource): SeoEnv {
  return { siteUrl: normalizeSiteUrl(source.VITE_SITE_URL), indexing: source.VITE_INDEXING === 'true' };
}

export const SEO_ENV: SeoEnv = readSeoEnv(import.meta.env);

/** URL absoluta de una ruta de la web (canónico, Open Graph, sitemap). */
export function absoluteUrl(path: string, env: SeoEnv): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${env.siteUrl}${clean === '/' ? '/' : clean.replace(/\/+$/, '')}`;
}
