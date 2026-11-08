import { createContext, useContext } from 'react';
import type { SeoPage } from '../model/seo/types';

/**
 * Recogida de datos durante el prerender (al compilar). Solo existe en el servidor:
 * en el navegador el contexto es null y los hooks aplican sus efectos al documento.
 * - useSeoHead guarda la cabecera de la página que se está pintando;
 * - useViewStyles guarda las hojas de la vista (el HTML estático las enlaza);
 * - usePageMeta guarda la clase del <body>.
 */
export interface PrerenderCollector {
  setPage(page: SeoPage): void;
  addSheets(view: string, sheets: readonly string[]): void;
  setBodyClass(className: string): void;
}

export interface CollectedPage {
  page: SeoPage | null;
  sheets: readonly string[];
  bodyClass: string;
}

export const PrerenderContext = createContext<PrerenderCollector | null>(null);

export function usePrerenderCollector(): PrerenderCollector | null {
  return useContext(PrerenderContext);
}

/** Colector de una página: cada render de prerender usa uno nuevo. */
export function createCollector(): PrerenderCollector & { result(): CollectedPage } {
  let page: SeoPage | null = null;
  let bodyClass = '';
  const sheets = new Map<string, readonly string[]>();
  return {
    setPage(next) { page = next; },
    addSheets(view, list) { sheets.set(view, list); },
    setBodyClass(className) { bodyClass = className; },
    result() {
      // Cada hoja una sola vez y en el orden en que las pidió la vista (como useViewStyles).
      const ordered = [...new Set([...sheets.values()].flat())];
      return { page, sheets: ordered, bodyClass };
    },
  };
}
