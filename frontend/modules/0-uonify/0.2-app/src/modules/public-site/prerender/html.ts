import { HELP_HOME_SEO } from '../model/seo/pages';
import { DEFAULT_IMAGE } from '../model/seo/site';
import type { SeoPage } from '../model/seo/types';

/**
 * Utilidades de texto sobre el HTML que devuelve React al prerenderizar (sin DOM:
 * se ejecutan en Node al compilar).
 */
const HOISTED = /^\s*(<link\b[^>]*>|<meta\b[^>]*>|<title\b[^>]*>[\s\S]*?<\/title>)/;

/**
 * React sube al principio del HTML las etiquetas «de cabecera» (pistas de carga de
 * imágenes, <title> y <meta> que pinten los componentes). Se separan del marcado de
 * #root. De las pistas solo se conservan las de prioridad alta (la imagen principal):
 * el navegador ya descubre el resto en el HTML.
 */
export function splitHoisted(html: string): { hoisted: string[]; body: string; preloads: string } {
  const hoisted: string[] = [];
  let rest = html;
  for (let match = HOISTED.exec(rest); match; match = HOISTED.exec(rest)) {
    hoisted.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  const preloads = hoisted.filter(tag => /^<link\b/i.test(tag) && /\bfetchpriority="high"/i.test(tag)).join('');
  return { hoisted, body: rest, preloads };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'", nbsp: ' ' };

/** Texto visible de un fragmento de HTML (sin etiquetas, entidades básicas resueltas). */
export function textContent(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, (_, entity: string) => ENTITIES[entity])
    .replace(/\s+/g, ' ')
    .trim();
}

/** Recorta un texto a una meta descripción (160 caracteres como máximo, sin cortar palabras). */
export function truncate(text: string, max = 160): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 0)) || cut}…`;
}

function firstMatch(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  return match ? textContent(match[1]) : '';
}

/**
 * Cabecera de una ruta que no la declaró con useSeoHead: la portada del centro de
 * ayuda tiene la suya; el resto se deduce del <title> que pinte la página, de su h1 y
 * de su primer párrafo.
 */
export function fallbackSeoPage(path: string, body: string, hoisted: readonly string[] = []): SeoPage {
  if (path === HELP_HOME_SEO.path) return HELP_HOME_SEO;
  const hoistedHtml = hoisted.join('');
  const heading = firstMatch(body, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const title = firstMatch(hoistedHtml, /<title\b[^>]*>([\s\S]*?)<\/title>/i) || (heading ? `${heading} — Uonify` : 'Uonify');
  const metaDescription = /<meta\b[^>]*name="description"[^>]*content="([^"]*)"/i.exec(hoistedHtml)?.[1];
  const description = truncate(metaDescription ? textContent(metaDescription) : firstMatch(body, /<p\b[^>]*>([\s\S]*?)<\/p>/i) || title);
  const inHelp = path.startsWith(`${HELP_HOME_SEO.path}/`);
  const crumbs = [
    ...(inHelp ? [{ name: 'Ayuda', path: HELP_HOME_SEO.path }] : []),
    ...(path !== '/' ? [{ name: heading || title, path }] : []),
  ];
  return {
    path,
    title,
    description,
    breadcrumbs: crumbs.length ? crumbs : undefined,
    image: DEFAULT_IMAGE,
    type: inHelp ? 'article' : 'website',
  };
}
