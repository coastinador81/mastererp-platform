import { absoluteUrl, type SeoEnv } from './env';
import { pageJsonLd } from './jsonLd';
import { DEFAULT_IMAGE, SHELL_HEAD, SITE } from './site';
import type { SeoPage } from './types';

/**
 * Etiquetas de la cabecera de una página, como datos: el navegador las aplica al
 * <head> (hooks/headDom.ts) y el prerender las escribe en el HTML estático. Cada una
 * lleva una clave estable (data-uon-head) para poder actualizarla o quitarla.
 */
export interface HeadTag {
  name: 'title' | 'meta' | 'link' | 'script';
  key: string;
  attrs: Readonly<Record<string, string>>;
  text?: string;
}

/** Atributo que marca las etiquetas que gestiona la web pública. */
export const HEAD_ATTR = 'data-uon-head';

export const ROBOTS_CLOSED = 'noindex, nofollow';
export const ROBOTS_OPEN = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

/** noindex hasta el lanzamiento; después, solo las páginas marcadas como no indexables. */
export function robotsFor(page: Pick<SeoPage, 'indexable'>, env: SeoEnv): string {
  return env.indexing && page.indexable !== false ? ROBOTS_OPEN : ROBOTS_CLOSED;
}

const meta = (key: string, attrs: Record<string, string>): HeadTag => ({ name: 'meta', key, attrs });
const link = (key: string, attrs: Record<string, string>): HeadTag => ({ name: 'link', key, attrs });
const property = (name: string, content: string) => meta(name, { property: name, content });
const named = (name: string, content: string) => meta(name, { name, content });

export function buildHeadTags(page: SeoPage, env: SeoEnv): HeadTag[] {
  const url = absoluteUrl(page.path, env);
  const image = page.image ?? DEFAULT_IMAGE;
  const imageUrl = absoluteUrl(image.path, env);
  return [
    { name: 'title', key: 'title', attrs: {}, text: page.title },
    named('description', page.description),
    named('robots', robotsFor(page, env)),
    link('canonical', { rel: 'canonical', href: url }),
    link(`hreflang-${SITE.hreflang}`, { rel: 'alternate', hreflang: SITE.hreflang, href: url }),
    link('hreflang-x-default', { rel: 'alternate', hreflang: 'x-default', href: url }),
    property('og:type', page.type ?? 'website'),
    property('og:site_name', SITE.name),
    property('og:locale', SITE.ogLocale),
    property('og:url', url),
    property('og:title', page.title),
    property('og:description', page.description),
    property('og:image', imageUrl),
    property('og:image:width', String(image.width)),
    property('og:image:height', String(image.height)),
    property('og:image:alt', image.alt),
    named('twitter:card', 'summary_large_image'),
    named('twitter:title', page.title),
    named('twitter:description', page.description),
    named('twitter:image', imageUrl),
    named('twitter:image:alt', image.alt),
    { name: 'script', key: 'jsonld', attrs: { type: 'application/ld+json' }, text: JSON.stringify(pageJsonLd(page, env)) },
  ];
}

/** Cabecera de la aplicación (index.html): la que queda fuera de las páginas públicas. */
export const SHELL_HEAD_TAGS: readonly HeadTag[] = [
  { name: 'title', key: 'title', attrs: {}, text: SHELL_HEAD.title },
  named('description', SHELL_HEAD.description),
  named('robots', SHELL_HEAD.robots),
];

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** JSON dentro de <script>: sin «</script>» ni comentarios HTML posibles. */
export function escapeScriptJson(json: string): string {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** HTML de las etiquetas, una por línea, para la cabecera del prerender. */
export function serializeHeadTags(tags: readonly HeadTag[]): string {
  return tags
    .map(tag => {
      if (tag.name === 'title') return `<title>${escapeHtml(tag.text ?? '')}</title>`;
      const attrs = Object.entries(tag.attrs).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('');
      const marker = ` ${HEAD_ATTR}="${escapeHtml(tag.key)}"`;
      if (tag.name === 'script') return `<script${attrs}${marker}>${escapeScriptJson(tag.text ?? '')}</script>`;
      return `<${tag.name}${attrs}${marker} />`;
    })
    .join('\n    ');
}
