import { http } from 'msw';
import { collection, record } from '@/shared/mocks/db';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { AI_BILLING_ENDPOINTS } from '../api/aiBilling';
import { ASSISTANT_ENDPOINTS, type AssistantMessageRequest, type AssistantMessageResponse } from '../api/assistant';
import { USAGE_LIMIT_ERROR } from '../model/aiLimit';
import { blocked, consume, initialUsage, payerOf, resetOf, tokenCost, toUsageData, type UsageState } from './usageModel';

/**
 * Simulación del backend del espacio de trabajo (contrato para el documento de
 * backend). Prefijo /api/ai/* y /api/assistant/* (módulo workspace):
 *
 *   GET  /api/ai/usage
 *     200 → { plan, payer, limitReached, simulated,
 *             limits: [{ label, usedPercent, reset | resetText, windowMinutes, resetsAt }] }
 *
 *   POST /api/assistant/messages
 *     body  { threadId, service, text, model, effort, speed }
 *     201 → { id, threadId, receivedAt, usage, charged }
 *     400 → { error: 'invalid_message', message }
 *     429 → { error: 'subscription_sharing_usage_limit_exceeded', message, resetText }
 *           (plan de ChatGPT agotado y el cliente no ha elegido pagar con tokens)
 *
 *   POST /api/ai/payer   body { payer: 'chatgpt' | 'uonify_tokens' }
 *     200 → { payer, scope: 'session', usage }
 *     402 → { error: 'plan_required', message, feature: 'uony_tokens' } (sin plan)
 *
 *   GET  /api/ai/quote?model&effort&speed → { tokens, amount, currency } por mensaje
 *
 *   GET|PUT /api/ai/simulation  { limitReached?, hasPlan? }  → solo la simulación:
 *     el interruptor «Simular límite alcanzado» (el backend real no la tiene).
 *
 * La sesión la simula auth y el saldo (/api/billing/balance), billing.
 */
interface StoredMessage extends AssistantMessageRequest {
  id: string;
  receivedAt: string;
}

const usage = record<UsageState>('workspace-ai-usage', () => initialUsage());
const messages = collection<StoredMessage>('workspace-assistant-messages');

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value ? value : fallback);

function simulation() {
  const state = usage.get();
  return { limitReached: Boolean(state.simulatedLimit), hasPlan: Boolean(state.hasPlan), usage: toUsageData(state) };
}

export const handlers = [
  http.get(mock(ASSISTANT_ENDPOINTS.USAGE), async () => {
    await latency(300);
    return HttpResponse.json(toUsageData(usage.get()));
  }),

  http.post(mock(ASSISTANT_ENDPOINTS.MESSAGES), async ({ request }) => {
    await latency(250);
    const body = (await request.json().catch(() => null)) as Partial<AssistantMessageRequest> | null;
    const message = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!body || !message || typeof body.threadId !== 'string') return fail(400, 'El mensaje está vacío o no tiene hilo.', 'invalid_message');
    const current = usage.get();
    if (blocked(current)) {
      const resetText = resetOf(current);
      return HttpResponse.json(
        { error: USAGE_LIMIT_ERROR, message: `Has llegado al límite de uso de tu plan de ChatGPT. Se restablece ${resetText}.`, resetText },
        { status: 429 },
      );
    }
    const stored: StoredMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      threadId: body.threadId,
      service: typeof body.service === 'string' ? body.service : null,
      text: message.slice(0, 3000),
      model: text(body.model, 'auto'),
      effort: text(body.effort, 'medium'),
      speed: body.speed === 'fast' ? 'fast' : 'standard',
      receivedAt: new Date().toISOString(),
    };
    messages.upsert(stored);
    const charged = payerOf(current) === 'uonify_tokens' ? tokenCost(stored.model, stored.effort, stored.speed) : null;
    const next = usage.update(state => consume(state, stored.effort, stored.speed));
    const response: AssistantMessageResponse = { id: stored.id, threadId: stored.threadId, receivedAt: stored.receivedAt, usage: toUsageData(next), charged };
    return HttpResponse.json(response, { status: 201 });
  }),

  http.post(mock(AI_BILLING_ENDPOINTS.PAYER), async ({ request }) => {
    await latency(400);
    const body = (await request.json().catch(() => null)) as { payer?: unknown } | null;
    const payer = body?.payer;
    if (payer !== 'chatgpt' && payer !== 'uonify_tokens') return fail(400, 'Elige cómo quieres que trabaje Uony.', 'invalid_payer');
    if (payer === 'uonify_tokens' && !usage.get().hasPlan) {
      return HttpResponse.json(
        { error: 'plan_required', message: 'Para seguir con tokens de Uonify necesitas un plan de Uonify.', feature: 'uony_tokens' },
        { status: 402 },
      );
    }
    const next = usage.update(state => ({ ...state, payer }));
    return HttpResponse.json({ payer, scope: 'session', usage: toUsageData(next) });
  }),

  http.get(mock(AI_BILLING_ENDPOINTS.QUOTE), async ({ request }) => {
    await latency(200);
    const params = new URL(request.url).searchParams;
    return HttpResponse.json(tokenCost(text(params.get('model'), 'auto'), text(params.get('effort'), 'medium'), text(params.get('speed'), 'standard')));
  }),

  http.get(mock(AI_BILLING_ENDPOINTS.SIMULATION), async () => {
    await latency(100);
    return HttpResponse.json(simulation());
  }),

  http.put(mock(AI_BILLING_ENDPOINTS.SIMULATION), async ({ request }) => {
    await latency(150);
    const body = (await request.json().catch(() => null)) as { limitReached?: unknown; hasPlan?: unknown } | null;
    usage.update(state => ({
      ...state,
      simulatedLimit: typeof body?.limitReached === 'boolean' ? body.limitReached : state.simulatedLimit,
      hasPlan: typeof body?.hasPlan === 'boolean' ? body.hasPlan : state.hasPlan,
    }));
    return HttpResponse.json(simulation());
  }),
];
