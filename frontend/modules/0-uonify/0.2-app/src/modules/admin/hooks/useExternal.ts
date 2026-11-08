import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '../api/adminApi';
import { articlesApi, pricingApi, supportApi } from '../api/externalApi';
import { TICKET_STATUS } from '../model/labels';
import type { AdminPlan, ArticleDraft, AuditEventInput, BillingConfigView, HelpArticle, HelpConfigView, PlanDraft, TicketStatus } from '../model/types';
import { ADMIN_KEY, EXTERNAL_KEY } from './useAdminSession';

/**
 * Datos de billing y help que el panel lee y cambia con sus endpoints. Cada cambio se
 * anota en la auditoría y refresca también las consultas del propio módulo dueño
 * (p. ej. ['billing', 'plans'] de usePlans()), así el resto de la aplicación lo ve.
 */
const key = {
  plans: [EXTERNAL_KEY, 'billing', 'plans'] as const,
  billingConfig: [EXTERNAL_KEY, 'billing', 'config'] as const,
  helpConfig: [EXTERNAL_KEY, 'help', 'config'] as const,
  articles: [EXTERNAL_KEY, 'help', 'articles'] as const,
  tickets: [EXTERNAL_KEY, 'support', 'tickets'] as const,
};

/** Anota en la auditoría una acción hecha con billing o help. No bloquea si falla. */
export function useRecordAudit() {
  const client = useQueryClient();
  return (event: AuditEventInput) =>
    auditApi
      .record(event)
      .catch(() => undefined)
      .finally(() => void client.invalidateQueries({ queryKey: [ADMIN_KEY, 'audit'] }));
}

export function usePlansAdmin() {
  return useQuery({ queryKey: key.plans, queryFn: pricingApi.plans });
}

export function useUpdatePlan() {
  const client = useQueryClient();
  const record = useRecordAudit();
  return useMutation({
    mutationFn: ({ plan, draft }: { plan: AdminPlan; draft: PlanDraft; reason: string; detail: string }) => pricingApi.updatePlan(plan, draft),
    onSuccess: (updated, { plan, reason, detail }) => {
      client.setQueryData<AdminPlan[]>(key.plans, list => list?.map(item => (item.id === updated.id ? updated : item)));
      void client.invalidateQueries({ queryKey: ['billing'] });
      void record({ action: 'plan.update', target: { type: 'plan', id: plan.id, label: plan.name }, reason, detail });
    },
  });
}

export function useBillingConfig() {
  return useQuery({ queryKey: key.billingConfig, queryFn: pricingApi.billingConfig });
}

export function useUpdateBillingConfig() {
  const client = useQueryClient();
  const record = useRecordAudit();
  return useMutation({
    mutationFn: ({ config, values }: { config: BillingConfigView; values: { minTopUp: number; patronAmount: number }; reason: string; detail: string }) =>
      pricingApi.updateBillingConfig(config, values),
    onSuccess: (next, { reason, detail }) => {
      client.setQueryData(key.billingConfig, next);
      void client.invalidateQueries({ queryKey: ['billing'] });
      void record({ action: 'billing_config.update', target: { type: 'configuracion', id: 'billing', label: 'Recargas y «Apoya a Uonify»' }, reason, detail });
    },
  });
}

export function useHelpConfig() {
  return useQuery({ queryKey: key.helpConfig, queryFn: pricingApi.helpConfig });
}

export function useUpdateHelpConfig() {
  const client = useQueryClient();
  const record = useRecordAudit();
  return useMutation({
    mutationFn: ({ config, price }: { config: HelpConfigView; price: number; reason: string; detail: string }) => pricingApi.updateHelpConfig(config, price),
    onSuccess: (next, { reason, detail }) => {
      client.setQueryData(key.helpConfig, next);
      void client.invalidateQueries({ queryKey: ['help'] });
      void record({ action: 'help_config.update', target: { type: 'configuracion', id: 'help', label: 'Videollamada de soporte' }, reason, detail });
    },
  });
}

// ── Artículos ───────────────────────────────────────────────────────────────

export function useArticles() {
  return useQuery({ queryKey: key.articles, queryFn: articlesApi.list });
}

export function useArticle(id: string | undefined) {
  return useQuery({ queryKey: [...key.articles, id], queryFn: () => articlesApi.get(id ?? ''), enabled: !!id });
}

type ArticleAction = 'article.create' | 'article.update' | 'article.publish' | 'article.unpublish';

/** Acción de auditoría según lo que cambia al guardar. */
export function articleAction(before: HelpArticle | undefined, draft: ArticleDraft): ArticleAction {
  if (!before) return draft.status === 'published' ? 'article.publish' : 'article.create';
  if (before.status !== draft.status) return draft.status === 'published' ? 'article.publish' : 'article.unpublish';
  return 'article.update';
}

export function useSaveArticle() {
  const client = useQueryClient();
  const record = useRecordAudit();
  return useMutation({
    mutationFn: ({ article, draft }: { article?: HelpArticle; draft: ArticleDraft }) => (article ? articlesApi.update(article, draft) : articlesApi.create(draft)),
    onSuccess: (saved, { article, draft }) => {
      client.setQueryData([...key.articles, saved.id], saved);
      void client.invalidateQueries({ queryKey: key.articles, exact: true });
      void client.invalidateQueries({ queryKey: ['help'] });
      void record({ action: articleAction(article, draft), target: { type: 'articulo', id: saved.id, label: saved.title } });
    },
  });
}

export function useDeleteArticle() {
  const client = useQueryClient();
  const record = useRecordAudit();
  return useMutation({
    mutationFn: (article: HelpArticle) => articlesApi.remove(article),
    onSuccess: (_result, article) => {
      client.removeQueries({ queryKey: [...key.articles, article.id] });
      void client.invalidateQueries({ queryKey: key.articles, exact: true });
      void client.invalidateQueries({ queryKey: ['help'] });
      void record({ action: 'article.delete', target: { type: 'articulo', id: article.id, label: article.title } });
    },
  });
}

// ── Soporte ─────────────────────────────────────────────────────────────────

export function useTickets() {
  return useQuery({ queryKey: key.tickets, queryFn: supportApi.tickets });
}

export function useTicket(id: string | undefined) {
  return useQuery({ queryKey: [...key.tickets, id], queryFn: () => supportApi.ticket(id ?? ''), enabled: !!id });
}

export function useTicketActions(id: string, label: string) {
  const client = useQueryClient();
  const record = useRecordAudit();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key.tickets });
    void client.invalidateQueries({ queryKey: ['support'] });
  };
  const reply = useMutation({
    mutationFn: ({ body, authorName }: { body: string; authorName: string }) => supportApi.reply(id, body, authorName),
    onSuccess: () => {
      refresh();
      void record({ action: 'ticket.reply', target: { type: 'ticket', id, label } });
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: TicketStatus) => supportApi.setStatus(id, status),
    onSuccess: (_result, status) => {
      refresh();
      void record({ action: 'ticket.status', target: { type: 'ticket', id, label }, detail: `Estado: ${TICKET_STATUS[status].label}` });
    },
  });
  return { reply, setStatus };
}
