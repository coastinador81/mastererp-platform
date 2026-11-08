import { api } from '@/shared/api/client';
import {
  isJson,
  normalizeArticle,
  normalizeArticles,
  normalizeBillingConfig,
  normalizeHelpConfig,
  normalizePlan,
  normalizePlans,
  normalizeTicket,
  normalizeTickets,
  withVideoCallPrice,
  type Json,
} from '../model/normalize';
import type {
  AdminPlan,
  ArticleDraft,
  BillingConfigView,
  HelpArticle,
  HelpConfigView,
  PlanDraft,
  TicketStatus,
} from '../model/types';

/**
 * Llamadas a los endpoints de otros módulos (docs/FRONTEND-FASE-2.md): admin cambia
 * precios, configuración, artículos y tickets con la API de billing y help, nunca con
 * datos propios. Se guarda devolviendo el objeto original con los campos cambiados.
 */

/**
 * Lo que el otro módulo dice haber guardado: `{ <clave>: {...} }`, el propio objeto o
 * nada (p. ej. `{ ok: true }`). Se mezcla sobre lo enviado.
 */
function saved(payload: unknown, key: string, looksLike: (value: Json) => boolean): Json {
  if (!isJson(payload)) return {};
  const nested = payload[key];
  if (isJson(nested)) return nested;
  return looksLike(payload) ? payload : {};
}

const isEntity = (value: Json) => 'id' in value || 'slug' in value;
const isConfig = (value: Json) => Object.keys(value).some(key => key !== 'ok' && key !== 'message');

// ── Billing: planes y configuración ─────────────────────────────────────────

export const pricingApi = {
  plans: () => api.get<unknown>('/billing/plans').then(normalizePlans),
  updatePlan: (plan: AdminPlan, draft: PlanDraft) => {
    const sent = { ...plan.raw, ...draft };
    return api.put<unknown>(`/billing/plans/${encodeURIComponent(plan.id)}`, sent).then(payload => normalizePlan({ ...sent, ...saved(payload, 'plan', isEntity) }));
  },
  billingConfig: () => api.get<unknown>('/billing/config').then(normalizeBillingConfig),
  updateBillingConfig: (config: BillingConfigView, values: { minTopUp: number; patronAmount: number }) => {
    const sent = { ...config.raw, [config.minTopUp.key]: values.minTopUp, [config.patronAmount.key]: values.patronAmount };
    return api.put<unknown>('/billing/config', sent).then(payload => normalizeBillingConfig({ ...sent, ...saved(payload, 'config', isConfig) }));
  },
  helpConfig: () => api.get<unknown>('/help/config').then(normalizeHelpConfig),
  updateHelpConfig: (config: HelpConfigView, price: number) => {
    const sent = withVideoCallPrice(config, price);
    return api.put<unknown>('/help/config', sent).then(payload => normalizeHelpConfig({ ...sent, ...saved(payload, 'config', isConfig) }));
  },
};

// ── Help: artículos ─────────────────────────────────────────────────────────

/**
 * Cuerpo de alta o edición con la forma de help (HelpArticleInput): campos planos,
 * y lo que admin no edita (tema, orden) se conserva del original.
 */
function articleBody(draft: ArticleDraft, base?: HelpArticle): Json {
  const meta = isJson(base?.raw.metadata) ? base.raw.metadata : {};
  const kept: Json = {};
  if (typeof meta.topic === 'string') kept.topic = meta.topic;
  if (typeof base?.raw.order === 'number') kept.order = base.raw.order;
  return {
    ...kept,
    slug: draft.slug,
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    collection: draft.collection,
    status: draft.status,
    plan: draft.plan,
    keywords: draft.keywords,
    assistantNotes: draft.assistantNotes,
  };
}

export const articlesApi = {
  /** Todas, también los borradores (el centro público solo enseña las publicadas). */
  list: () => api.get<unknown>('/help/articles', { params: { status: 'all' } }).then(normalizeArticles),
  get: (id: string) => api.get<unknown>(`/help/articles/${encodeURIComponent(id)}`).then(payload => normalizeArticle(saved(payload, 'article', isEntity))),
  create: (draft: ArticleDraft) => {
    const sent = articleBody(draft);
    return api.post<unknown>('/help/articles', sent).then(payload => normalizeArticle({ ...sent, ...saved(payload, 'article', isEntity) }));
  },
  update: (article: HelpArticle, draft: ArticleDraft) => {
    const sent = articleBody(draft, article);
    return api
      .put<unknown>(`/help/articles/${encodeURIComponent(article.id)}`, sent)
      .then(payload => normalizeArticle({ ...sent, ...saved(payload, 'article', isEntity) }));
  },
  remove: (article: HelpArticle) => api.delete<unknown>(`/help/articles/${encodeURIComponent(article.id)}`),
};

// ── Help: soporte (tickets y conversaciones de Uony derivadas) ─────────────

export const supportApi = {
  tickets: () => api.get<unknown>('/support/tickets', { params: { scope: 'all' } }).then(normalizeTickets),
  ticket: (id: string) => api.get<unknown>(`/support/tickets/${encodeURIComponent(id)}`).then(normalizeTicket),
  reply: (id: string, body: string, authorName: string) =>
    api.post<unknown>(`/support/tickets/${encodeURIComponent(id)}/messages`, { body, message: body, author: 'team', authorName }),
  setStatus: (id: string, status: TicketStatus) => api.patch<unknown>(`/support/tickets/${encodeURIComponent(id)}`, { status }),
};

