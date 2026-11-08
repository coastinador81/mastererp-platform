import { useLayoutEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { usePageMeta } from '../../hooks/usePageMeta';
import { useViewStyles } from '../../hooks/useViewStyles';
import type { PublicViewMeta } from '../../model/views';
import { endPrerenderLanding, isPrerenderLanding } from '../../prerender/snapshot';

/**
 * Marco de cada vista pública: cabecera (SEO), clase del <body>, hojas de la vista y
 * posición inicial. Como el PROTO tras cargar los estilos: con #ancla se desplaza
 * hasta ella; sin ancla, la vista empieza arriba. Si la vista sustituye a su HTML
 * prerenderizado, se respeta el desplazamiento que la persona ya haya hecho.
 */
export function PublicView({ view, sheets, children }: { view: PublicViewMeta; sheets: readonly string[]; children: ReactNode }) {
  usePageMeta(view);
  useViewStyles(view.key, sheets);
  const { pathname, hash } = useLocation();
  useLayoutEffect(() => {
    const landing = isPrerenderLanding(pathname);
    endPrerenderLanding();
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) target.scrollIntoView?.();
    else if (!landing && typeof window.scrollTo === 'function') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Solo al entrar en la vista: las anclas internas las resuelve el navegador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return <>{children}</>;
}
