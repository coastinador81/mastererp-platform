import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router';
import { SEO_PAGES } from '../model/seo/pages';
import type { PublicViewMeta } from '../model/views';
import { usePrerenderCollector } from '../prerender/collector';
import { isPrerenderLanding } from '../prerender/snapshot';
import { useSeoHead } from './useSeoHead';

/**
 * Cabecera de la vista (título, descripción, robots, canónico, Open Graph y JSON-LD)
 * y clase del <body> (unified.js). Al salir se devuelve la clase anterior del <body>
 * para no afectar a la siguiente vista; si la vista viene del HTML prerenderizado, la
 * clase que ya tenía el <body> era la suya y no se devuelve.
 */
export function usePageMeta(view: PublicViewMeta): void {
  useSeoHead(SEO_PAGES[view.key]);
  usePrerenderCollector()?.setBodyClass(view.bodyClass ?? '');
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const body = document.body;
    const previous = isPrerenderLanding(pathname) ? '' : body.className;
    body.className = view.bodyClass || '';
    return () => { body.className = previous; };
  }, [view, pathname]);
}
