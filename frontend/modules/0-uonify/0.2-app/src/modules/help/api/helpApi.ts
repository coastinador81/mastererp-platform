import { api } from '@/shared/api/client';
import type {
  HelpArticle, HelpArticleInput, HelpArticleSummary, HelpCollection, HelpConfig, SearchResponse,
} from '../model/types';
import { HELP_PATHS } from './paths';

/** Llamadas del centro de ayuda (contrato en paths.ts). */

export function getHelpConfig(signal?: AbortSignal): Promise<HelpConfig> {
  return api.get<HelpConfig>(HELP_PATHS.config, { signal });
}

export function updateHelpConfig(config: Partial<HelpConfig>): Promise<HelpConfig> {
  return api.put<HelpConfig>(HELP_PATHS.config, config);
}

export function getCollections(signal?: AbortSignal): Promise<HelpCollection[]> {
  return api.get<HelpCollection[]>(HELP_PATHS.collections, { signal });
}

export interface ArticleListParams {
  collection?: string;
  sort?: 'popular';
  limit?: number;
  /** «all» incluye borradores (admin). */
  status?: 'all';
}

export function getArticles(params: ArticleListParams = {}, signal?: AbortSignal): Promise<HelpArticleSummary[]> {
  return api.get<HelpArticleSummary[]>(HELP_PATHS.articles, { params: { ...params }, signal });
}

export function getArticle(slug: string, signal?: AbortSignal): Promise<HelpArticle> {
  return api.get<HelpArticle>(HELP_PATHS.article(slug), { signal });
}

export function createArticle(input: HelpArticleInput): Promise<HelpArticle> {
  return api.post<HelpArticle>(HELP_PATHS.articles, input);
}

export function updateArticle(slug: string, input: HelpArticleInput): Promise<HelpArticle> {
  return api.put<HelpArticle>(HELP_PATHS.article(slug), input);
}

export function deleteArticle(slug: string): Promise<void> {
  return api.delete<void>(HELP_PATHS.article(slug));
}

export function searchArticles(q: string, limit = 8, signal?: AbortSignal): Promise<SearchResponse> {
  return api.get<SearchResponse>(HELP_PATHS.search, { params: { q, limit }, signal });
}

export interface FeedbackResult {
  helpful: number;
  notHelpful: number;
}

export function sendArticleFeedback(slug: string, helpful: boolean, comment?: string): Promise<FeedbackResult> {
  return api.post<FeedbackResult>(HELP_PATHS.feedback(slug), { helpful, comment: comment?.trim() || undefined });
}
