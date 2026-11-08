import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebouncedValue } from '@/shared/hooks';
import { getArticle, getArticles, getCollections, getHelpConfig, searchArticles, sendArticleFeedback, type ArticleListParams } from '../api/helpApi';
import type { HelpArticle, HelpArticleSummary, HelpCollection } from '../model/types';

/** Datos del centro de ayuda con TanStack Query. */
export const helpKeys = {
  all: ['help'] as const,
  config: ['help', 'config'] as const,
  collections: ['help', 'collections'] as const,
  articles: (params: ArticleListParams) => ['help', 'articles', params] as const,
  article: (slug: string) => ['help', 'article', slug] as const,
  search: (q: string) => ['help', 'search', q] as const,
};

export function useHelpConfig() {
  return useQuery({ queryKey: helpKeys.config, queryFn: ({ signal }) => getHelpConfig(signal), staleTime: 60_000 });
}

/**
 * Colecciones. `initial` pinta al instante el contenido del paquete (centro público
 * y prerender) y se refresca con el servidor al montar.
 */
export function useCollections(initial?: HelpCollection[]) {
  return useQuery({
    queryKey: helpKeys.collections,
    queryFn: ({ signal }) => getCollections(signal),
    initialData: initial,
    initialDataUpdatedAt: 0,
  });
}

export function useArticles(params: ArticleListParams = {}, initial?: HelpArticleSummary[]) {
  return useQuery({
    queryKey: helpKeys.articles(params),
    queryFn: ({ signal }) => getArticles(params, signal),
    initialData: initial,
    initialDataUpdatedAt: 0,
  });
}

export function useArticle(slug: string, initial?: HelpArticle) {
  return useQuery({
    queryKey: helpKeys.article(slug),
    queryFn: ({ signal }) => getArticle(slug, signal),
    initialData: initial,
    initialDataUpdatedAt: 0,
    retry: false,
    enabled: !!slug,
  });
}

/** Búsqueda con espera de 250 ms mientras se escribe; conserva los resultados anteriores. */
export function useHelpSearch(query: string, limit = 8) {
  const q = useDebouncedValue(query.trim(), 250);
  const result = useQuery({
    queryKey: [...helpKeys.search(q), limit],
    queryFn: ({ signal }) => searchArticles(q, limit, signal),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  return { ...result, debouncedQuery: q, settled: q === query.trim() && !result.isFetching };
}

export function useArticleFeedback(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ helpful, comment }: { helpful: boolean; comment?: string }) => sendArticleFeedback(slug, helpful, comment),
    onSuccess: () => client.invalidateQueries({ queryKey: ['help', 'articles'] }),
  });
}
