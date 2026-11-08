import { prerender } from 'react-dom/static';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createStaticHandler, createStaticRouter, StaticRouterProvider, type RouteObject } from 'react-router';
import type { SeoPage } from '../model/seo/types';
import { createCollector, PrerenderContext } from './collector';
import { fallbackSeoPage, splitHoisted } from './html';

/** Resultado de prerenderizar una ruta. */
export interface RenderedPage {
  path: string;
  status: 'ok' | 'redirect' | 'not-found';
  /** Marcado de #root. */
  html: string;
  /** Pistas de carga que React sube a la cabecera (solo la imagen principal). */
  preloads: string;
  /** Cabecera SEO: la que declaró la página con useSeoHead o una deducida del HTML. */
  page: SeoPage;
  /** Hojas de la vista, en orden (texto CSS). */
  sheets: readonly string[];
  bodyClass: string;
  /** Destino si la ruta redirige. */
  location?: string;
}

const origin = 'https://prerender.uonify.invalid';

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

/**
 * Pinta una ruta a HTML estático con el router estático de React Router: resuelve
 * antes las rutas diferidas (lazy) y espera a los Suspense (react-dom/static). La web
 * pública no pide datos: sin sesión, sin API. Los datos de TanStack Query quedan en
 * «pendiente» y los efectos no se ejecutan.
 */
export async function renderRoute(routes: RouteObject[], path: string): Promise<RenderedPage> {
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(new URL(path, origin)));
  const empty = { path, html: '', preloads: '', sheets: [], bodyClass: '', page: fallbackSeoPage(path, '') };
  if (context instanceof Response) {
    return { ...empty, status: 'redirect', location: context.headers.get('Location') ?? undefined };
  }
  const deepest = context.matches[context.matches.length - 1];
  if (!deepest || deepest.route.path === '*' || context.statusCode === 404) return { ...empty, status: 'not-found' };

  const collector = createCollector();
  const router = createStaticRouter(handler.dataRoutes, context);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const { prelude } = await prerender(
    <PrerenderContext.Provider value={collector}>
      <QueryClientProvider client={client}>
        <StaticRouterProvider router={router} context={context} hydrate={false} />
      </QueryClientProvider>
    </PrerenderContext.Provider>,
  );
  const { hoisted, body, preloads } = splitHoisted(await readStream(prelude));
  const collected = collector.result();
  // Una ruta que pinta <Navigate> (p. ej. una página aún inexistente) no deja marcado.
  if (!body.trim()) return { ...empty, status: 'not-found' };
  return {
    path,
    status: 'ok',
    html: body,
    preloads,
    page: collected.page ?? fallbackSeoPage(path, body, hoisted),
    sheets: collected.sheets,
    bodyClass: collected.bodyClass,
  };
}
