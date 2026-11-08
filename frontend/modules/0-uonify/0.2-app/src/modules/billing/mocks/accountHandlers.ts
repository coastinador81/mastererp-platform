import { http } from 'msw';
import { HttpResponse, fail, latency, mock } from '@/shared/mocks/utils';
import { formatNumber, monthLabel } from '../model/money';
import { withVat } from '../model/quote';
import { rechargeError, rechargeQuote, splitSpend, tokenTotals } from '../model/recharge';
import { parsePaymentCard } from '../model/card';
import type { PaymentDetails } from '../model/types';
import { resolvePayment, savePaymentChoice } from './cards';
import { documentPdf } from './pdf';
import {
  addMovement,
  cardDb,
  configDb,
  currentBalance,
  documentsNewestFirst,
  invoicesDb,
  issueDocument,
  movementsDb,
  movementsNewestFirst,
  subscriptionDb,
} from './store';

/**
 * Simulación MSW de la cartera de /api/billing/* (contrato del backend).
 *
 * GET    /billing/balance                → { amount, currency, tokens, tokenPrice, included, recharged }
 *                                          (amount y currency: contrato que ya lee pim-video)
 * GET    /billing/movements?limit=       → { movements, total }
 * POST   /billing/recharge               → { movement, invoice, balance } (400 recharge_minimum / recharge_maximum)
 * GET    /billing/payment-method         → { paymentMethod }
 * PUT    /billing/payment-method         → { paymentMethod } (tarjeta nueva desde el formulario de Stripe)
 * GET    /billing/invoices               → { invoices } (facturas, notas de crédito y rectificativas)
 * GET    /billing/invoices/:id/pdf       → application/pdf
 * POST   /billing/support                → { subscription, invoice } («Apoya a Uonify»)
 * DELETE /billing/support                → { subscription }
 *
 * Solo desarrollo y pruebas (no existen en el backend):
 * POST   /billing/dev/paywall            → 402 { error: 'plan_required' | 'tokens_required', message, feature }
 * POST   /billing/dev/spend              → { balance } o 402 tokens_required (simula un consumo de tokens)
 */

const PAYWALL_MESSAGES = {
  plan_required: 'Esta función necesita un plan de pago.',
  tokens_required: 'No te quedan tokens de Uonify suficientes.',
} as const;

export const accountHandlers = [
  http.get(mock('/billing/balance'), async () => {
    await latency(300);
    return HttpResponse.json(currentBalance());
  }),

  http.get(mock('/billing/movements'), async ({ request }) => {
    await latency(250);
    const limit = Number(new URL(request.url).searchParams.get('limit')) || 20;
    const movements = movementsNewestFirst();
    return HttpResponse.json({ movements: movements.slice(0, Math.min(Math.max(limit, 1), 100)), total: movements.length });
  }),

  http.post(mock('/billing/recharge'), async ({ request }) => {
    const body = (await request.json()) as Partial<PaymentDetails> & { amount?: unknown };
    await latency(1000);
    const config = configDb.get();
    const amount = typeof body?.amount === 'number' && Number.isFinite(body.amount) ? body.amount : null;
    const problem = rechargeError(amount, config);
    if (problem || amount === null) {
      const code = amount !== null && amount > config.maxRecharge ? 'recharge_maximum' : 'recharge_minimum';
      return fail(400, problem ?? 'Importe no válido.', code);
    }
    const card = resolvePayment(body);
    if (!card) return fail(400, 'Introduce una tarjeta válida para pagar.', 'payment_method_required');
    const quote = rechargeQuote(amount, config);
    const invoice = issueDocument('invoice', `Recarga de tokens de Uonify · ${formatNumber(quote.tokens)} tokens`, quote.amounts);
    const movement = addMovement({ kind: 'recharge', tokens: quote.tokens, account: 'recharged', concept: 'Recarga de tokens de Uonify', invoiceId: invoice.id });
    savePaymentChoice(body, card);
    return HttpResponse.json({ movement, invoice, balance: currentBalance(), paymentMethod: card }, { status: 201 });
  }),

  http.get(mock('/billing/payment-method'), async () => {
    await latency(200);
    return HttpResponse.json({ paymentMethod: cardDb.get().card });
  }),

  http.put(mock('/billing/payment-method'), async ({ request }) => {
    const body = await request.json() as { newCard?: unknown };
    const card = parsePaymentCard(body.newCard);
    if (!card) return fail(400, 'Introduce una tarjeta válida.', 'payment_method_required');
    // Stripe confirma la tarjeta (SetupIntent) y el servidor la guarda por su id.
    await latency(900);
    const subscription = subscriptionDb.get();
    subscriptionDb.set({ ...subscription,
      ...(subscription.planId !== 'free' ? { renewalPaymentMethod: card } : {}),
      support: subscription.support.active ? { ...subscription.support, renewalPaymentMethod: card } : subscription.support,
    });
    return HttpResponse.json({ paymentMethod: cardDb.set({ card }).card });
  }),

  http.get(mock('/billing/invoices'), async () => {
    await latency(250);
    return HttpResponse.json({ invoices: documentsNewestFirst() });
  }),

  http.get(mock('/billing/invoices/:id/pdf'), async ({ params }) => {
    await latency(400);
    const doc = invoicesDb.get(String(params.id));
    if (!doc) return fail(404, 'Este documento ya no está disponible.', 'not_found');
    return new HttpResponse(documentPdf(doc), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${doc.number}.pdf"` },
    });
  }),

  http.post(mock('/billing/support'), async ({ request }) => {
    const body = await request.json() as Partial<PaymentDetails>;
    const card = resolvePayment(body);
    if (!card) return fail(400, 'Introduce una tarjeta válida para pagar.', 'payment_method_required');
    await latency(900);
    const subscription = subscriptionDb.get();
    if (subscription.support.active) return fail(409, 'Ya apoyas a Uonify. ¡Gracias!', 'already_supporting');
    const { supportAmount, vatRate } = configDb.get();
    const now = new Date();
    const invoice = issueDocument('invoice', `Apoya a Uonify · ${monthLabel(now)}`, withVat(supportAmount, vatRate));
    const next = subscriptionDb.set({ ...subscription, support: { active: true, amount: supportAmount, since: now.toISOString(), renewalPaymentMethod: card } });
    savePaymentChoice(body, card);
    return HttpResponse.json({ subscription: next, invoice }, { status: 201 });
  }),

  http.delete(mock('/billing/support'), async () => {
    await latency(600);
    const subscription = subscriptionDb.get();
    return HttpResponse.json({ subscription: subscriptionDb.set({ ...subscription, support: { active: false, amount: 0, since: null } }) });
  }),

  http.post(mock('/billing/dev/paywall'), async ({ request }) => {
    const body = (await request.json()) as { code?: unknown; feature?: unknown; message?: unknown };
    await latency(80);
    const code = body?.code === 'tokens_required' ? 'tokens_required' : 'plan_required';
    const message = typeof body?.message === 'string' ? body.message : PAYWALL_MESSAGES[code];
    const feature = typeof body?.feature === 'string' ? body.feature : undefined;
    return HttpResponse.json({ error: code, message, feature }, { status: 402 });
  }),

  http.post(mock('/billing/dev/spend'), async ({ request }) => {
    const body = (await request.json()) as { tokens?: unknown; concept?: unknown; feature?: unknown };
    await latency(80);
    const cost = typeof body?.tokens === 'number' && body.tokens > 0 ? Math.round(body.tokens) : 0;
    if (!cost) return fail(400, 'Indica cuántos tokens se gastan.', 'invalid_spend');
    const feature = typeof body.feature === 'string' ? body.feature : 'uony';
    const split = splitSpend(tokenTotals(movementsDb.all()), cost);
    if (!split) return HttpResponse.json({ error: 'tokens_required', message: PAYWALL_MESSAGES.tokens_required, feature }, { status: 402 });
    const concept = typeof body.concept === 'string' && body.concept ? body.concept : 'Consumo de Uony';
    if (split.included) addMovement({ kind: 'spend', tokens: -split.included, account: 'included', concept, feature });
    if (split.recharged) addMovement({ kind: 'spend', tokens: -split.recharged, account: 'recharged', concept, feature });
    return HttpResponse.json({ balance: currentBalance() });
  }),
];
