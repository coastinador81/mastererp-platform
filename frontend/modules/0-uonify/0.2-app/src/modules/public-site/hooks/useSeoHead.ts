import { useLayoutEffect, useMemo } from 'react';
import { SEO_ENV } from '../model/seo/env';
import { buildHeadTags, serializeHeadTags, SHELL_HEAD_TAGS } from '../model/seo/head';
import type { SeoPage } from '../model/seo/types';
import { usePrerenderCollector } from '../prerender/collector';
import { applyHead } from './headDom';

/**
 * Cabecera de una página pública: título, descripción, robots (noindex hasta el
 * lanzamiento), canónico, hreflang, Open Graph, Twitter y JSON-LD.
 * - Al compilar (prerender) la guarda para escribirla en el HTML estático.
 * - En el navegador la aplica al <head> y, al salir, vuelve a la cabecera de la
 *   aplicación (noindex), así las vistas privadas nunca heredan la de una página pública.
 * Lo pueden usar otros módulos con páginas públicas (centro de ayuda).
 */
export function useSeoHead(page: SeoPage): void {
  const collector = usePrerenderCollector();
  collector?.setPage(page);
  const tags = useMemo(() => buildHeadTags(page, SEO_ENV), [page]);
  // La firma evita reaplicar si la página llega como objeto nuevo con el mismo contenido.
  const signature = useMemo(() => serializeHeadTags(tags), [tags]);
  useLayoutEffect(() => {
    applyHead(tags);
    return () => applyHead(SHELL_HEAD_TAGS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
