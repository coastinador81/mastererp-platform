import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { formatUsd } from '../model/format';
import { AUDIT_ACTIONS } from '../model/labels';
import { can } from '../model/permissions';
import type { AdminMetrics, AiProvider, AuditTarget, CreditNote, MetricsRange } from '../model/types';
import { reasonError } from '../model/validation';
import { currentMember, db, forbidden, logAudit, newId, unauthenticated } from './adminDb';
import { METRICS } from './fixtures/metrics';

/**
 * Resumen, proveedores de IA, auditoría, facturación y el borrador de respuesta con
 * Uony (/api/admin/*). Todas las acciones del equipo quedan en la auditoría.
 */
const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Acciones que llegan de billing y help (el backend real las registra él mismo). */
const EXTERNAL_ACTIONS = new Set([
  'plan.update', 'billing_config.update', 'help_config.update',
  'article.create', 'article.update', 'article.publish', 'article.unpublish', 'article.delete',
  'ticket.reply', 'ticket.status',
]);
const TARGET_TYPES = new Set<AuditTarget['type']>(['plan', 'configuracion', 'articulo', 'ticket']);

function providerChanges(before: AiProvider, after: AiProvider): string {
  const changes: string[] = [];
  if (before.enabled !== after.enabled) changes.push(after.enabled ? 'Encendido' : 'Apagado');
  if (before.monthlyCapUsd !== after.monthlyCapUsd) changes.push(`Tope mensual: ${formatUsd(before.monthlyCapUsd)} → ${formatUsd(after.monthlyCapUsd)}`);
  if (before.fallback && after.fallback && before.fallback.enabled !== after.fallback.enabled) {
    changes.push(after.fallback.enabled ? 'Respaldo encendido' : 'Respaldo apagado');
  }
  return changes.join(' · ');
}

export const opsHandlers = [
  http.get(mock('/admin/metrics'), async ({ request }) => {
    await latency(350);
    if (!currentMember()) return unauthenticated();
    const range = (new URL(request.url).searchParams.get('range') ?? '30d') as MetricsRange;
    const metrics: AdminMetrics | undefined = METRICS[range];
    if (!metrics) return fail(400, 'Periodo no válido.', 'invalid_range');
    return HttpResponse.json(metrics);
  }),

  http.get(mock('/admin/providers'), async () => {
    await latency(300);
    if (!currentMember()) return unauthenticated();
    return HttpResponse.json({ providers: db.providers.all() });
  }),

  http.patch(mock('/admin/providers/:id'), async ({ params, request }) => {
    const body = await readJson(request);
    await latency(450);
    const member = currentMember();
    if (!member) return unauthenticated();
    if (!can(member.role, 'providers.edit')) return forbidden('Solo Operaciones o un superadmin pueden cambiar los proveedores.');
    const provider = db.providers.get(String(params.id));
    if (!provider) return fail(404, 'No existe ese proveedor.', 'provider_not_found');
    const reason = str(body.reason);
    const error = reasonError(reason);
    if (error) return fail(400, error, 'reason_required');
    const next: AiProvider = { ...provider };
    if (typeof body.enabled === 'boolean') next.enabled = body.enabled;
    if (body.monthlyCapUsd !== undefined) {
      const cap = body.monthlyCapUsd;
      if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0 || cap > 100_000) return fail(400, 'El tope debe estar entre 0 y 100.000 $.', 'invalid_cap');
      next.monthlyCapUsd = Math.round(cap * 100) / 100;
    }
    if (typeof body.fallbackEnabled === 'boolean' && next.fallback) next.fallback = { ...next.fallback, enabled: body.fallbackEnabled };
    next.pausedByCap = next.spentUsd >= next.monthlyCapUsd;
    const detail = providerChanges(provider, next);
    if (!detail) return fail(400, 'No has cambiado nada.', 'no_changes');
    db.providers.upsert(next);
    logAudit(member, 'provider.update', { type: 'proveedor', id: provider.id, label: provider.name }, { reason, detail });
    return HttpResponse.json({ provider: next });
  }),

  http.get(mock('/admin/audit'), async ({ request }) => {
    await latency(300);
    const member = currentMember();
    if (!member) return unauthenticated();
    if (member.role === 'lectura') return forbidden('Tu rol no puede ver la auditoría.');
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const action = url.searchParams.get('action') ?? '';
    const actor = url.searchParams.get('actor') ?? '';
    const entries = db.audit
      .all()
      .filter(entry => can(member.role, 'audit.all') || entry.actor.email === member.email)
      .filter(entry => !action || entry.action === action)
      .filter(entry => !actor || entry.actor.email === actor)
      .filter(entry => !q || [entry.target.label, entry.target.id, entry.actor.name, entry.reason ?? '', entry.detail ?? '', AUDIT_ACTIONS[entry.action] ?? ''].some(v => v.toLowerCase().includes(q)))
      .sort((a, b) => b.at.localeCompare(a.at));
    return HttpResponse.json({ entries });
  }),

  http.post(mock('/admin/audit/events'), async ({ request }) => {
    const body = await readJson(request);
    await latency(80);
    const member = currentMember();
    if (!member) return unauthenticated();
    const action = str(body.action);
    const target = body.target as Partial<AuditTarget> | undefined;
    if (!EXTERNAL_ACTIONS.has(action) || !target || !TARGET_TYPES.has(target.type as AuditTarget['type']) || !str(target.id)) {
      return fail(400, 'Evento de auditoría no válido.', 'invalid_event');
    }
    const entry = logAudit(member, action, { type: target.type as AuditTarget['type'], id: str(target.id), label: str(target.label) || str(target.id) }, {
      reason: str(body.reason) || undefined,
      detail: str(body.detail) || undefined,
    });
    return HttpResponse.json({ entry }, { status: 201 });
  }),

  http.get(mock('/admin/finance/invoices'), async ({ request }) => {
    await latency(300);
    if (!currentMember()) return unauthenticated();
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const status = url.searchParams.get('status') ?? '';
    const invoices = db.invoices
      .all()
      .filter(invoice => (!q || `${invoice.number} ${invoice.customerName} ${invoice.concept}`.toLowerCase().includes(q)) && (!status || invoice.status === status))
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    return HttpResponse.json({ invoices });
  }),

  http.get(mock('/admin/finance/withdrawals'), async () => {
    await latency(300);
    if (!currentMember()) return unauthenticated();
    return HttpResponse.json({ withdrawals: db.withdrawals.all().sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)) });
  }),

  http.post(mock('/admin/finance/withdrawals/:id/retry'), async ({ params, request }) => {
    const body = await readJson(request);
    await latency(700);
    const member = currentMember();
    if (!member) return unauthenticated();
    if (!can(member.role, 'finance.retry')) return forbidden('Solo Finanzas o un superadmin pueden reintentar devoluciones.');
    const withdrawal = db.withdrawals.get(String(params.id));
    if (!withdrawal) return fail(404, 'No existe ese desistimiento.', 'withdrawal_not_found');
    if (withdrawal.status !== 'failed') return fail(409, 'Solo se reintentan las devoluciones fallidas.', 'not_failed');
    const reason = str(body.reason);
    const error = reasonError(reason);
    if (error) return fail(400, error, 'reason_required');
    const sequence = db.creditNotes.all().length + 3;
    const note: CreditNote = {
      id: newId('cn'),
      number: `NC-2026-${String(sequence).padStart(5, '0')}`,
      customerName: withdrawal.customerName,
      issuedAt: new Date().toISOString(),
      invoiceNumber: withdrawal.invoiceNumber,
      correctiveInvoiceNumber: `R-2026-${String(sequence).padStart(5, '0')}`,
      amountEur: withdrawal.refundEur,
      reason: `Desistimiento en 14 días: se descuentan ${withdrawal.tokensSpent.toLocaleString('es-ES')} tokens gastados.`,
    };
    db.creditNotes.upsert(note);
    const next = db.withdrawals.patch(withdrawal.id, { status: 'refunded', creditNoteNumber: note.number, error: undefined }) ?? withdrawal;
    const invoice = db.invoices.all().find(item => item.number === withdrawal.invoiceNumber);
    if (invoice) db.invoices.patch(invoice.id, { status: withdrawal.tokensSpent > 0 ? 'partially_refunded' : 'refunded' });
    logAudit(member, 'withdrawal.retry', { type: 'desistimiento', id: withdrawal.id, label: withdrawal.customerName }, { reason, detail: `Nota de crédito ${note.number}` });
    return HttpResponse.json({ withdrawal: next });
  }),

  http.get(mock('/admin/finance/credit-notes'), async () => {
    await latency(250);
    if (!currentMember()) return unauthenticated();
    return HttpResponse.json({ creditNotes: db.creditNotes.all().sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)) });
  }),

  http.post(mock('/admin/support/reply-draft'), async ({ request }) => {
    const body = await readJson(request);
    await latency(1200);
    const member = currentMember();
    if (!member) return unauthenticated();
    const name = str(body.customerName).split(' ')[0] || '';
    const subject = str(body.subject).toLowerCase();
    const greeting = name ? `Hola, ${name}:` : 'Hola:';
    const draft = [
      greeting,
      '',
      `Gracias por escribirnos sobre «${subject || 'tu consulta'}». Ya lo hemos revisado en tu cuenta.`,
      'Te explicamos los pasos para resolverlo y, si algo no encaja, respóndenos a este mismo mensaje y lo vemos contigo.',
      '',
      `Un saludo,\n${member.name.split(' ')[0]} · Equipo de Uonify`,
    ].join('\n');
    return HttpResponse.json({ draft });
  }),
];
