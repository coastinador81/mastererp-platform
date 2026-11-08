/**
 * Simulación de /help/* (contrato en api/paths.ts): configuración, colecciones,
 * artículos con su CRUD para admin, búsqueda y valoraciones.
 */
import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { HELP_PATHS } from '../api/paths';
import { SEED_COLLECTIONS } from '../content';
import { isPublished, sortArticles, toSummary, validateArticleInput } from '../model/articles';
import { redactSensitive } from '../model/assistant/redact';
import { validateHelpConfig } from '../model/config';
import { buildIndex, search } from '../model/search';
import { normalize } from '../model/text';
import type { HelpArticle, HelpArticleInput, SearchResponse } from '../model/types';
import { articlesDb, configDb, feedbackDb, missesDb, publicArticle, type StoredArticle } from './store';

const COLLECTION_IDS = SEED_COLLECTIONS.map(item => item.id);
const today = () => new Date().toISOString().slice(0, 10);

export function publishedArticles(): HelpArticle[] {
  return sortArticles(articlesDb.all().filter(isPublished), COLLECTION_IDS).map(publicArticle);
}

function stored(input: HelpArticleInput, previous?: StoredArticle): StoredArticle {
  return {
    id: input.slug,
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    body: input.body,
    keywords: input.keywords ?? [],
    assistantNotes: input.assistantNotes ?? [],
    order: input.order ?? previous?.order ?? articlesDb.all().filter(a => a.metadata.collection === input.collection).length + 1,
    views: previous?.views ?? 0,
    helpful: previous?.helpful ?? 0,
    notHelpful: previous?.notHelpful ?? 0,
    metadata: {
      collection: input.collection,
      audience: 'seller',
      topic: input.topic ?? input.collection,
      plan: input.plan ?? 'all',
      status: input.status ?? 'draft',
      updatedAt: today(),
    },
  };
}

export const helpHandlers = [
  http.get(mock(HELP_PATHS.config), async () => {
    await latency(200);
    return HttpResponse.json(configDb.get());
  }),

  http.put(mock(HELP_PATHS.config), async ({ request }) => {
    await latency(300);
    const result = validateHelpConfig(await request.json().catch(() => null), configDb.get());
    if (!result.ok) return fail(400, result.message, 'invalid_config');
    return HttpResponse.json(configDb.set(result.config));
  }),

  http.get(mock(HELP_PATHS.collections), async () => {
    await latency(200);
    const published = articlesDb.all().filter(isPublished);
    return HttpResponse.json(SEED_COLLECTIONS.map(item => ({ ...item, articleCount: published.filter(a => a.metadata.collection === item.id).length })));
  }),

  http.get(mock(HELP_PATHS.articles), async ({ request }) => {
    await latency(250);
    const url = new URL(request.url);
    const collectionId = url.searchParams.get('collection');
    const includeDrafts = url.searchParams.get('status') === 'all';
    let list = sortArticles(articlesDb.all().filter(a => includeDrafts || isPublished(a)), COLLECTION_IDS);
    if (collectionId) list = list.filter(a => a.metadata.collection === collectionId);
    if (url.searchParams.get('sort') === 'popular') list = [...list].sort((a, b) => b.views - a.views);
    const limit = Number(url.searchParams.get('limit'));
    if (Number.isInteger(limit) && limit > 0) list = list.slice(0, limit);
    return HttpResponse.json(list.map(item => toSummary(publicArticle(item))));
  }),

  http.get(mock(HELP_PATHS.search), async ({ request }) => {
    await latency(220);
    const url = new URL(request.url);
    const query = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 8));
    const results = query ? search(buildIndex(publishedArticles()), query, { limit }) : [];
    if (query.length >= 3 && !results.length) {
      // Métrica de búsquedas sin resultado (para escribir los artículos que faltan).
      const id = normalize(query).replace(/\s+/g, ' ');
      const previous = missesDb.get(id);
      missesDb.upsert({ id, query, count: (previous?.count ?? 0) + 1, lastAt: new Date().toISOString() });
    }
    const body: SearchResponse = { query, total: results.length, results };
    return HttpResponse.json(body);
  }),

  http.get(mock(HELP_PATHS.searchMisses), async () => {
    await latency(200);
    return HttpResponse.json(missesDb.all().sort((a, b) => b.count - a.count).map(({ id: _id, ...miss }) => miss));
  }),

  http.get(mock('/help/articles/:slug'), async ({ params, request }) => {
    await latency(250);
    const item = articlesDb.get(String(params.slug));
    const preview = new URL(request.url).searchParams.get('preview') === '1';
    if (!item || (!preview && !isPublished(item))) return fail(404, 'No encontramos este artículo. Puede que se haya movido o eliminado.', 'not_found');
    const next = preview ? item : articlesDb.patch(item.id, { views: item.views + 1 }) ?? item;
    return HttpResponse.json(publicArticle(next));
  }),

  http.post(mock(HELP_PATHS.articles), async ({ request }) => {
    await latency(300);
    const result = validateArticleInput(await request.json().catch(() => null), COLLECTION_IDS);
    if (!result.ok) return fail(400, result.message, 'invalid_article');
    if (articlesDb.get(result.value.slug)) return fail(409, 'Ya hay un artículo con ese slug.', 'slug_taken');
    return HttpResponse.json(publicArticle(articlesDb.upsert(stored(result.value))), { status: 201 });
  }),

  http.put(mock('/help/articles/:slug'), async ({ params, request }) => {
    await latency(300);
    const previous = articlesDb.get(String(params.slug));
    if (!previous) return fail(404, 'No encontramos este artículo.', 'not_found');
    const result = validateArticleInput({ slug: previous.slug, ...((await request.json().catch(() => null)) as object | null) }, COLLECTION_IDS);
    if (!result.ok) return fail(400, result.message, 'invalid_article');
    if (result.value.slug !== previous.slug) {
      if (articlesDb.get(result.value.slug)) return fail(409, 'Ya hay un artículo con ese slug.', 'slug_taken');
      articlesDb.remove(previous.id);
    }
    return HttpResponse.json(publicArticle(articlesDb.upsert(stored(result.value, previous))));
  }),

  http.delete(mock('/help/articles/:slug'), async ({ params }) => {
    await latency(250);
    if (!articlesDb.remove(String(params.slug))) return fail(404, 'No encontramos este artículo.', 'not_found');
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(mock('/help/articles/:slug/feedback'), async ({ params, request }) => {
    await latency(200);
    const item = articlesDb.get(String(params.slug));
    if (!item || !isPublished(item)) return fail(404, 'No encontramos este artículo.', 'not_found');
    const body = (await request.json().catch(() => null)) as { helpful?: unknown; comment?: unknown } | null;
    if (typeof body?.helpful !== 'boolean') return fail(400, 'Indica si el artículo te ha resultado útil.', 'invalid_feedback');
    const comment = typeof body.comment === 'string' ? redactSensitive(body.comment.trim().slice(0, 1000)).text : '';
    feedbackDb.upsert({ id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, slug: item.slug, helpful: body.helpful, comment: comment || null, createdAt: new Date().toISOString() });
    const next = articlesDb.patch(item.id, body.helpful ? { helpful: item.helpful + 1 } : { notHelpful: item.notHelpful + 1 }) ?? item;
    return HttpResponse.json({ helpful: next.helpful, notHelpful: next.notHelpful });
  }),
];
