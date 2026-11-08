import type { SeoEnv } from '../model/seo/env';
import { buildHeadTags, escapeHtml, serializeHeadTags } from '../model/seo/head';
import { PRERENDER_ATTR, PRERENDER_STYLE_ATTR } from './markers';
import type { RenderedPage } from './render';

/** Marcas de index.html que delimitan la cabecera que cambia en cada página. */
export const HEAD_START = '<!--uon-head-->';
export const HEAD_END = '<!--/uon-head-->';

/**
 * Si el HTML llega a una ruta distinta (un alojamiento que sirve la portada como
 * respaldo para /espacio), se vacía #root antes de pintar nada: la aplicación arranca
 * limpia en lugar de enseñar un instante la página equivocada.
 */
export const ROUTE_GUARD =
  `<script>(function(){var r=document.getElementById('root'),p=location.pathname.replace(/\\/+$/,'')||'/';` +
  `if(r&&r.getAttribute('${PRERENDER_ATTR}')!==p)r.innerHTML='';}());</script>`;

function replaceHead(template: string, head: string): string {
  const start = template.indexOf(HEAD_START);
  const end = template.indexOf(HEAD_END);
  if (start >= 0 && end > start) {
    return `${template.slice(0, start + HEAD_START.length)}\n    ${head}\n    ${template.slice(end)}`;
  }
  // Sin marcas: se quitan título, descripción y robots de la plantilla y se añade la cabecera.
  const cleaned = template
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name="(description|robots)"[^>]*>\s*/gi, '');
  return cleaned.replace(/<head>/i, () => `<head>\n    ${head}`);
}

/**
 * HTML final de una página prerenderizada a partir del index.html compilado:
 * cabecera SEO, hojas de la vista, clase del <body>, marcado de #root y la guarda de ruta.
 * El resto de la plantilla (CSS global y el módulo de la aplicación) queda igual,
 * así la aplicación arranca encima y toma el relevo. Los reemplazos van con función
 * porque el marcado y el JSON-LD pueden contener «$&» y similares.
 */
export function buildDocument(template: string, rendered: RenderedPage, env: SeoEnv, styleHrefs: readonly string[]): string {
  if (!/<div id="root"><\/div>/.test(template)) throw new Error('index.html debe tener <div id="root"></div> vacío.');
  const head = serializeHeadTags(buildHeadTags(rendered.page, env));
  const styles = styleHrefs.map(href => `<link rel="stylesheet" href="${escapeHtml(href)}" ${PRERENDER_STYLE_ATTR} />`).join('\n    ');
  const extras = [rendered.preloads, styles].filter(Boolean).join('\n    ');
  let html = replaceHead(template, head);
  if (extras) html = html.replace(/<\/head>/i, () => `  ${extras}\n  </head>`);
  if (rendered.bodyClass) html = html.replace(/<body([^>]*)>/i, (_, attrs: string) => `<body${attrs} class="${escapeHtml(rendered.bodyClass)}">`);
  const root = `<div id="root" ${PRERENDER_ATTR}="${escapeHtml(rendered.path)}">${rendered.html}</div>\n    ${ROUTE_GUARD}`;
  return html.replace(/<div id="root"><\/div>/, () => root);
}

/** Archivo de salida de cada ruta: /productos → productos/index.html. */
export function outputFileFor(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `${clean}/index.html` : 'index.html';
}
