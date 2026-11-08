import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { formatTokens } from '../model/format';
import { ADJUSTMENT_CATEGORIES, SUSPEND_REASONS } from '../model/labels';
import { can, checkAdjustment } from '../model/permissions';
import type { AdjustmentCategory, InternalNote, LedgerEntry, SuspendReason, TeamMember } from '../model/types';
import { reasonError } from '../model/validation';
import { currentMember, customerDetail, customerTarget, db, forbidden, logAudit, newId, unauthenticated } from './adminDb';
import type { CustomerRecord } from './fixtures/customers';

/**
 * Clientes (/api/admin/customers/*): búsqueda, ficha, suspender y reactivar, cortar la
 * IA, notas internas y ajustes de saldo con motivo obligatorio. Por encima de 100 € el
 * ajuste queda pendiente hasta que lo apruebe otra persona con permiso.
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

type Guarded = { member: TeamMember; customer: CustomerRecord } | { error: Response };

function guard(id: string | readonly string[] | undefined): Guarded {
  const member = currentMember();
  if (!member) return { error: unauthenticated() };
  const customer = db.customers.get(String(id));
  if (!customer) return { error: fail(404, 'No existe esa cuenta.', 'customer_not_found') };
  return { member, customer };
}

function matches(customer: CustomerRecord, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [customer.company, customer.ownerEmail, customer.ownerName, customer.id, customer.stripeCustomerId, customer.amazonSellerId ?? '', ...customer.members.map(m => m.email)]
    .some(value => value.toLowerCase().includes(q));
}

function badReason(reason: string) {
  const error = reasonError(reason);
  return error ? fail(400, error, 'reason_required') : null;
}

export const customerHandlers = [
  http.get(mock('/admin/customers'), async ({ request }) => {
    await latency(300);
    if (!currentMember()) return unauthenticated();
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim();
    const status = url.searchParams.get('status') ?? '';
    const customers = db.customers
      .all()
      .filter(customer => matches(customer, q) && (!status || customer.status === status || (status === 'ai_blocked' && customer.aiBlocked)))
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
      .map(customer => {
        const { ledger: _ledger, members: _m, jobs: _j, acceptances: _a, notes: _n, amazon: _z, ...summary } = customerDetail(customer);
        return summary;
      });
    return HttpResponse.json({ customers });
  }),

  http.get(mock('/admin/customers/:id'), async ({ params }) => {
    await latency(250);
    const found = guard(params.id);
    if ('error' in found) return found.error;
    return HttpResponse.json({ customer: customerDetail(found.customer) });
  }),

  http.post(mock('/admin/customers/:id/suspend'), async ({ params, request }) => {
    const body = await readJson(request);
    await latency(450);
    const found = guard(params.id);
    if ('error' in found) return found.error;
    const { member, customer } = found;
    if (!can(member.role, 'customers.suspend')) return forbidden();
    const reason = str(body.reason);
    const invalid = badReason(reason);
    if (invalid) return invalid;
    const category = (str(body.category) in SUSPEND_REASONS ? str(body.category) : 'otro') as SuspendReason;
    if (customer.status === 'suspended') return fail(409, 'La cuenta ya está suspendida.', 'already_suspended');
    const suspendReason = `${SUSPEND_REASONS[category]}: ${reason}`;
    const next = db.customers.patch(customer.id, { status: 'suspended', suspendReason }) ?? customer;
    logAudit(member, 'customer.suspend', customerTarget(customer), { reason, detail: SUSPEND_REASONS[category] });
    return HttpResponse.json({ customer: customerDetail(next) });
  }),

  http.post(mock('/admin/customers/:id/reactivate'), async ({ params, request }) => {
    const body = await readJson(request);
    await latency(450);
    const found = guard(params.id);
    if ('error' in found) return found.error;
    const { member, customer } = found;
    if (!can(member.role, 'customers.suspend')) return forbidden();
    const reason = str(body.reason);
    const invalid = badReason(reason);
    if (invalid) return invalid;
    if (customer.status === 'active') return fail(409, 'La cuenta ya está activa.', 'already_active');
    const next = db.customers.patch(customer.id, { status: 'active', suspendReason: undefined }) ?? customer;
    logAudit(member, 'customer.reactivate', customerTarget(customer), { reason });
    return HttpResponse.json({ customer: customerDetail(next) });
  }),

  http.post(mock('/admin/customers/:id/ai-block'), async ({ params, request }) => {
    const body = await readJson(request);
    await latency(400);
    const found = guard(params.id);
    if ('error' in found) return found.error;
    const { member, customer } = found;
    if (!can(member.role, 'customers.aiBlock')) return forbidden();
    const reason = str(body.reason);
    const invalid = badReason(reason);
    if (invalid) return invalid;
    const blocked = body.blocked === true;
    const next = db.customers.patch(customer.id, { aiBlocked: blocked }) ?? customer;
    logAudit(member, blocked ? 'customer.ai_block' : 'customer.ai_unblock', customerTarget(customer), { reason });
    return HttpResponse.json({ customer: customerDetail(next) });
  }),

  http.post(mock('/admin/customers/:id/balance-adjustments'), async ({ params, request }) => {
    const body = await readJson(request);
    await latency(500);
    const found = guard(params.id);
    if ('error' in found) return found.error;
    const { member, customer } = found;
    const tokens = typeof body.tokens === 'number' && Number.isInteger(body.tokens) ? body.tokens : 0;
    if (!tokens) return fail(400, 'Escribe un importe en euros distinto de cero.', 'invalid_amount');
    const reason = str(body.reason);
    const invalid = badReason(reason);
    if (invalid) return invalid;
    const category = (str(body.category) in ADJUSTMENT_CATEGORIES ? str(body.category) : '') as AdjustmentCategory | '';
    if (!category) return fail(400, 'Elige el tipo de ajuste.', 'category_required');
    const check = checkAdjustment(member.role, tokens);
    if (!check.ok) return forbidden(check.message);
    if (tokens < 0 && customerDetail(customer).balanceTokens + tokens < 0) {
      return fail(409, 'El saldo no puede quedar en negativo. Resta como mucho el saldo disponible.', 'negative_balance');
    }
    const entry: LedgerEntry = {
      id: newId('led'),
      customerId: customer.id,
      at: new Date().toISOString(),
      type: 'ajuste',
      tokens,
      description: `Ajuste manual · ${ADJUSTMENT_CATEGORIES[category]}`,
      status: check.needsApproval ? 'pending' : 'posted',
      category,
      reason,
      author: member.name,
    };
    db.ledger.upsert(entry);
    logAudit(member, check.needsApproval ? 'customer.balance_request' : 'customer.balance_adjust', customerTarget(customer), {
      reason,
      detail: `${formatTokens(tokens, true)} (${ADJUSTMENT_CATEGORIES[category]})${check.needsApproval ? ' · pendiente de aprobación' : ''}`,
    });
    return HttpResponse.json({ customer: customerDetail(customer), entry }, { status: check.needsApproval ? 202 : 201 });
  }),

  http.post(mock('/admin/customers/:id/balance-adjustments/:entryId/approve'), async ({ params }) => {
    await latency(450);
    const found = guard(params.id);
    if ('error' in found) return found.error;
    const { member, customer } = found;
    if (!can(member.role, 'customers.approve')) return forbidden('Solo Finanzas o un superadmin pueden aprobar ajustes.');
    const entry = db.ledger.get(String(params.entryId));
    if (!entry || entry.customerId !== customer.id || entry.status !== 'pending') return fail(404, 'No hay ningún ajuste pendiente con ese número.', 'entry_not_found');
    if (entry.author === member.name) return fail(409, 'No puedes aprobar un ajuste que has pedido tú. Tiene que hacerlo otra persona.', 'same_person');
    const posted = db.ledger.patch(entry.id, { status: 'posted', approver: member.name }) ?? entry;
    logAudit(member, 'customer.balance_approve', customerTarget(customer), { reason: entry.reason, detail: formatTokens(entry.tokens, true) });
    return HttpResponse.json({ customer: customerDetail(customer), entry: posted });
  }),

  http.post(mock('/admin/customers/:id/notes'), async ({ params, request }) => {
    const body = await readJson(request);
    await latency(300);
    const found = guard(params.id);
    if ('error' in found) return found.error;
    const { member, customer } = found;
    if (!can(member.role, 'customers.note')) return forbidden();
    const text = str(body.text);
    if (text.length < 3) return fail(400, 'Escribe la nota.', 'note_required');
    if (text.length > 1000) return fail(400, 'La nota no puede pasar de 1.000 caracteres.', 'note_too_long');
    const note: InternalNote = { id: newId('note'), author: member.name, text, at: new Date().toISOString() };
    db.customers.patch(customer.id, { notes: [note, ...customer.notes] });
    logAudit(member, 'customer.note', customerTarget(customer));
    return HttpResponse.json({ note }, { status: 201 });
  }),
];
