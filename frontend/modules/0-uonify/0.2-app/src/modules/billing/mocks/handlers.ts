import { confirmOnboardingPayment, pendingCheckout } from './access';
import { resolvePayment, savePaymentChoice } from './cards';
import { http } from 'msw';
import { HttpResponse, fail, latency, mock } from '@/shared/mocks/utils';
import { addDays, addMonths } from '../model/money';
import { isBillingInterval, isPaidPlan, isPlanId, planChange, type BillingPlan, type BillingInterval, type PlanId } from '../model/plans';
import { quoteCheckout } from '../model/quote';
import { subscriptionInterval } from '../model/interval';
import { WITHDRAWAL_DAYS, withdrawalPreview } from '../model/refund';
import type { BillingConfig, CheckoutRequest, Subscription } from '../model/types';
import { accountHandlers } from './accountHandlers';
import {
  addMovement,
  allPlans,
  cardDb,
  configDb,
  expireIncluded,
  invoicesDb,
  issueDocument,
  movementsDb,
  planById,
  planName,
  plansDb,
  subscriptionDb,
} from './store';

/**
 * Simulación MSW de /api/billing/* (contrato del backend). Éxito por defecto, con
 * latencia; datos en sessionStorage. Este archivo: planes, configuración,
 * suscripción, pago mensual/anual y desistimiento. accountHandlers.ts: saldo, movimientos,
 * recargas, tarjeta, facturas, «Apoya a Uonify» y los ayudantes de desarrollo.
 *
 * GET  /billing/plans                    → { plans }
 * PUT  /billing/plans/:id                → { plan }          (admin)
 * GET  /billing/config                   → { config }
 * PUT  /billing/config                   → { config }        (admin)
 * GET  /billing/subscription             → { subscription }
 * PUT  /billing/subscription             → { subscription }  ({ scheduledPlanId }: bajar al renovar)
 * GET  /billing/checkout/preview?planId= → { quote }
 * POST /billing/checkout                 → { subscription, invoice, paymentMethod }
 * GET  /billing/withdrawal               → { withdrawal }    (vista previa)
 * POST /billing/withdrawal               → { refund, creditNote, correctiveInvoice, subscription, paymentMethod }
 */

const PLAN_TEXT_FIELDS = ['name', 'description', 'limits'] as const;

/** Valida y aplica los cambios de admin sobre un plan. */
function editPlan(plan: BillingPlan, body: Partial<BillingPlan>): BillingPlan | string {
  const next: BillingPlan = { ...plan };
  for (const field of PLAN_TEXT_FIELDS) {
    if (body[field] === undefined) continue;
    const value = String(body[field]).trim();
    if (!value && field === 'name') return 'El plan necesita un nombre.';
    next[field] = value;
  }
  if (body.monthlyPrice !== undefined) {
    if (plan.contactSales) next.monthlyPrice = null;
    else if (typeof body.monthlyPrice !== 'number' || !Number.isFinite(body.monthlyPrice) || body.monthlyPrice < 0) return 'El precio tiene que ser un número de 0 o más.';
    else next.monthlyPrice = body.monthlyPrice;
  }
  if (body.monthsPerYear !== undefined) {
    if (!Number.isInteger(body.monthsPerYear) || body.monthsPerYear < 12 || body.monthsPerYear > 24) return 'Los meses por año pagado van de 12 a 24.';
    next.monthsPerYear = body.monthsPerYear;
  }
  if (body.seats !== undefined) {
    if (body.seats !== null && (!Number.isInteger(body.seats) || body.seats < 1)) return 'Los usuarios tienen que ser 1 o más.';
    next.seats = body.seats;
  }
  if (body.includedTokens !== undefined) {
    if (body.includedTokens !== null && (!Number.isInteger(body.includedTokens) || body.includedTokens < 0)) return 'Los tokens incluidos tienen que ser 0 o más.';
    next.includedTokens = body.includedTokens;
  }
  if (body.popular !== undefined) next.popular = body.popular === true;
  return next;
}

function editConfig(config: BillingConfig, body: Partial<BillingConfig>): BillingConfig | string {
  const next = { ...config };
  const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (body.minRecharge !== undefined) {
    if (!positive(body.minRecharge)) return 'La recarga mínima tiene que ser mayor que 0.';
    next.minRecharge = body.minRecharge;
  }
  if (body.maxRecharge !== undefined) {
    if (!positive(body.maxRecharge)) return 'El máximo por recarga tiene que ser mayor que 0.';
    next.maxRecharge = body.maxRecharge;
  }
  if (next.maxRecharge < next.minRecharge) return 'El máximo por recarga no puede ser menor que la recarga mínima.';
  if (body.supportAmount !== undefined) {
    if (!positive(body.supportAmount)) return 'El importe de «Apoya a Uonify» tiene que ser mayor que 0.';
    next.supportAmount = body.supportAmount;
  }
  if (body.tokenPrice !== undefined) {
    if (!positive(body.tokenPrice)) return 'El precio del token tiene que ser mayor que 0.';
    next.tokenPrice = body.tokenPrice;
  }
  if (body.vatRate !== undefined) {
    if (typeof body.vatRate !== 'number' || body.vatRate < 0 || body.vatRate >= 1) return 'El IVA va de 0 a 1 (0,21 = 21 %).';
    next.vatRate = body.vatRate;
  }
  if (body.termsVersion !== undefined && String(body.termsVersion).trim()) next.termsVersion = String(body.termsVersion).trim();
  return next;
}

function currentPreview(now = new Date()) {
  const subscription = subscriptionDb.get();
  const invoice = subscription.invoiceId ? invoicesDb.get(subscription.invoiceId) : undefined;
  return withdrawalPreview({
    subscription,
    planName: planName(subscription.planId),
    movements: movementsDb.all(),
    tokenPrice: configDb.get().tokenPrice,
    invoiceNumber: invoice?.number ?? null,
    now,
  });
}

function checkoutQuote(plan: BillingPlan, interval: BillingInterval) {
  const subscription = subscriptionDb.get();
  return quoteCheckout({ plan, interval, vatRate: configDb.get().vatRate, current: subscription, currentPlanName: planName(subscription.planId) });
}

export const handlers = [
  http.get(mock('/billing/workspace-access'), async () => {
    await latency(150);
    const access = pendingCheckout();
    return access ? HttpResponse.json(access) : fail(403, 'Completa el acceso para continuar.', 'profile_required');
  }),

  http.get(mock('/billing/plans'), async () => {
    await latency(200);
    return HttpResponse.json({ plans: allPlans() });
  }),

  http.put(mock('/billing/plans/:id'), async ({ params, request }) => {
    const body = (await request.json()) as Partial<BillingPlan>;
    await latency(300);
    const id = String(params.id);
    const plan = isPlanId(id) ? planById(id) : undefined;
    if (!plan) return fail(404, 'Ese plan no existe.', 'not_found');
    const next = editPlan(plan, body ?? {});
    if (typeof next === 'string') return fail(400, next, 'invalid_plan');
    return HttpResponse.json({ plan: plansDb.upsert(next) });
  }),

  http.get(mock('/billing/config'), async () => {
    await latency(150);
    return HttpResponse.json({ config: configDb.get() });
  }),

  http.put(mock('/billing/config'), async ({ request }) => {
    const body = (await request.json()) as Partial<BillingConfig>;
    await latency(300);
    const next = editConfig(configDb.get(), body ?? {});
    if (typeof next === 'string') return fail(400, next, 'invalid_config');
    return HttpResponse.json({ config: configDb.set(next) });
  }),

  http.get(mock('/billing/subscription'), async () => {
    await latency(250);
    return HttpResponse.json({ subscription: subscriptionDb.get() });
  }),

  http.put(mock('/billing/subscription'), async ({ request }) => {
    const body = (await request.json()) as { scheduledPlanId?: unknown; scheduledInterval?: unknown };
    await latency(400);
    const subscription = subscriptionDb.get();
    if (subscription.planId === 'free') return fail(409, 'Tu cuenta ya está en el plan Gratis.', 'no_plan');
    const target = body?.scheduledPlanId ?? null;
    if (body.scheduledInterval !== undefined && !isBillingInterval(body.scheduledInterval)) return fail(400, 'Elige pago mensual o anual.', 'invalid_interval');
    const interval = body.scheduledInterval ?? subscriptionInterval(subscription);
    const cycleChange = target !== 'custom' && interval !== subscriptionInterval(subscription);
    if (target !== null && (!isPlanId(target) || (!cycleChange && planChange(subscription.planId, target) !== 'downgrade'))) {
      return fail(400, 'Solo se puede programar un cambio a un plan inferior. Para subir de plan, paga el nuevo plan.', 'invalid_change');
    }
    return HttpResponse.json({ subscription: subscriptionDb.set({ ...subscription, scheduledPlanId: target as PlanId | null, scheduledInterval: target === null || target === 'free' ? null : interval }) });
  }),

  http.get(mock('/billing/checkout/preview'), async ({ request }) => {
    await latency(300);
    const params = new URL(request.url).searchParams;
    const id = params.get('planId');
    const interval = params.get('interval') ?? 'annual';
    if (!isBillingInterval(interval)) return fail(400, 'Elige pago mensual o anual.', 'invalid_interval');
    const plan = isPlanId(id) ? planById(id) : undefined;
    if (!plan) return fail(404, 'Ese plan no existe.', 'not_found');
    if (!isPaidPlan(plan)) return fail(400, 'Este plan no se paga con tarjeta.', 'not_payable');
    return HttpResponse.json({ quote: checkoutQuote(plan, interval) });
  }),

  http.post(mock('/billing/checkout'), async ({ request }) => {
    const body = (await request.json()) as Partial<CheckoutRequest>;
    // Stripe tarda un poco en confirmar el cobro (y 3DS si hace falta).
    await latency(1200);
    const interval = body?.interval ?? 'annual';
    if (!isBillingInterval(interval)) return fail(400, 'Elige pago mensual o anual.', 'invalid_interval');
    const planId = body?.planId;
    const plan = isPlanId(planId) ? planById(planId) : undefined;
    if (!plan) return fail(404, 'Ese plan no existe.', 'not_found');
    if (!isPaidPlan(plan)) return fail(400, 'Este plan no se paga con tarjeta.', 'not_payable');
    if (body.acceptedTerms !== true || body.acceptedWithdrawal !== true) {
      return fail(400, 'Acepta las Condiciones y la información sobre el desistimiento para pagar.', 'terms_required');
    }
    const current = subscriptionDb.get();
    if (planChange(current.planId, plan.id) !== 'upgrade') return fail(409, `Ya tienes el plan ${planName(current.planId)} o uno superior.`, 'invalid_change');
    if (current.planId !== 'free' && subscriptionInterval(current) !== interval) return fail(409, 'Programa el cambio de modalidad para la próxima renovación.', 'interval_change_scheduled');
    const card = resolvePayment(body);
    if (!card) return fail(400, 'Introduce una tarjeta válida para pagar.', 'payment_method_required');
    const quote = checkoutQuote(plan, interval);
    const now = new Date();
    const periodLabel = interval === 'monthly' ? 'mensual' : 'anual';
    const concept = quote.credit > 0
      ? `Plan ${plan.name} ${periodLabel} · ${quote.months} meses (descontada la parte no usada de ${quote.creditPlanName})`
      : `Plan ${plan.name} ${periodLabel} · ${quote.months} meses por el precio de ${quote.paidMonths}`;
    const invoice = issueDocument('invoice', concept, quote.amounts);
    expireIncluded(`Tokens del plan ${planName(current.planId)} (cambio a ${plan.name})`);
    if (plan.includedTokens) addMovement({ kind: 'included', tokens: plan.includedTokens, account: 'included', concept: `Tokens incluidos en el plan ${plan.name}` });
    const subscription: Subscription = subscriptionDb.set({
      ...current,
      planId: plan.id,
      renewalPaymentMethod: card,
      interval,
      scheduledInterval: null,
      startedAt: now.toISOString(),
      renewsAt: addMonths(now, quote.months).toISOString(),
      months: quote.months,
      amountPaid: quote.amounts,
      invoiceId: invoice.id,
      withdrawalUntil: addDays(now, WITHDRAWAL_DAYS).toISOString(),
      scheduledPlanId: null,
    });
    savePaymentChoice(body, card);
    confirmOnboardingPayment(plan.id, interval, invoice.id);
    return HttpResponse.json({ subscription, invoice, paymentMethod: card }, { status: 201 });
  }),

  http.get(mock('/billing/withdrawal'), async () => {
    await latency(350);
    return HttpResponse.json({ withdrawal: currentPreview() });
  }),

  http.post(mock('/billing/withdrawal'), async () => {
    await latency(1100);
    const preview = currentPreview();
    if (!preview.eligible) {
      const message = preview.reason === 'expired' ? 'El plazo de 14 días para desistir ya ha terminado.' : 'No tienes un plan de pago del que desistir.';
      return fail(409, message, 'withdrawal_unavailable');
    }
    const subscription = subscriptionDb.get();
    const original = subscription.invoiceId ? invoicesDb.get(subscription.invoiceId) : undefined;
    const rectifies = original?.number;
    const concept = `Desistimiento del plan ${preview.planName}`;
    const creditNote = issueDocument('credit_note', `${concept} · devolución`, preview.refund, { rectifies });
    const correctiveInvoice = issueDocument('corrective', `${concept} · rectifica la factura ${rectifies ?? ''}`.trim(), preview.refund, { rectifies });
    if (original) invoicesDb.patch(original.id, { status: 'rectified' });
    expireIncluded(`Tokens del plan ${preview.planName} retirados por el desistimiento`);
    const next = subscriptionDb.set({
      ...subscription,
      planId: 'free',
      renewalPaymentMethod: undefined,
      interval: undefined,
      scheduledInterval: null,
      startedAt: null,
      renewsAt: null,
      months: null,
      amountPaid: null,
      invoiceId: null,
      withdrawalUntil: null,
      scheduledPlanId: null,
    });
    return HttpResponse.json({ refund: preview.refund, creditNote, correctiveInvoice, subscription: next, paymentMethod: subscription.renewalPaymentMethod ?? cardDb.get().card });
  }),

  ...accountHandlers,
];
