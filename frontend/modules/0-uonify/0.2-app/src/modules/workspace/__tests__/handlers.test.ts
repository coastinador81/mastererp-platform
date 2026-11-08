import { setupServer } from 'msw/node';
import { api, ApiError } from '@/shared/api/client';
import { onPlanRequired, type PlanRequiredDetail } from '@/shared/api/planRequired';
import { choosePayer, getLimitSimulation, getTokenQuote, setLimitSimulation } from '../api/aiBilling';
import { getUsage, postAssistantMessage } from '../api/assistant';
import { handlers } from '../mocks/handlers';

// Sin latencia simulada en las pruebas.
vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
// La simulación guarda su estado: cada prueba empieza sin límite, sin plan y con ChatGPT.
beforeEach(async () => {
  await setLimitSimulation({ limitReached: false, hasPlan: false });
  await choosePayer('chatgpt');
});

const message = { threadId: 't1', service: null, text: 'Hola, Uony', model: 'auto', effort: 'medium', speed: 'standard' };

describe('simulación del backend del espacio', () => {
  it('GET /api/ai/usage devuelve los límites del plan', async () => {
    const usage = await getUsage();
    expect(usage.plan).toBe('Free');
    expect(usage.limits?.map(limit => limit.label)).toEqual(['Límite de 5 horas', 'Semanal · todos los modelos']);
    expect(usage.limits?.[1].resetText).toMatch(/^el \S+, 3:00$/);
  });

  it('POST /api/assistant/messages registra la petición y gasta del límite', async () => {
    const before = (await getUsage()).limits?.[0].usedPercent ?? 0;
    const result = await postAssistantMessage({ threadId: 't1', service: null, text: 'Hola, Uony', model: 'auto', effort: 'high', speed: 'fast' });
    expect(result).toMatchObject({ threadId: 't1' });
    expect(result.id).toMatch(/^msg-/);
    expect(result.usage.limits?.[0].usedPercent).toBeCloseTo(before + 2.3, 1);
  });

  it('un mensaje vacío es un 400 con un motivo legible', async () => {
    const error = await api.post('/assistant/messages', { threadId: 't1', text: '  ' }).catch(reason => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, data: { error: 'invalid_message' } });
  });

  it('con el límite agotado, el mensaje es un 429 subscription_sharing_usage_limit_exceeded', async () => {
    const simulated = await setLimitSimulation({ limitReached: true });
    expect(simulated).toMatchObject({ limitReached: true, hasPlan: false, usage: { limitReached: true, simulated: true, payer: 'chatgpt' } });
    expect(await getUsage()).toMatchObject({ limitReached: true, simulated: true });
    const error = await postAssistantMessage(message).catch(reason => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, data: { error: 'subscription_sharing_usage_limit_exceeded' } });
    expect(error.data.message).toMatch(/^Has llegado al límite de uso de tu plan de ChatGPT\. Se restablece el \S+, 3:00\.$/);
  });

  it('sin plan, «tokens de Uonify» es un 402 plan_required que abre el muro de pago', async () => {
    const seen: PlanRequiredDetail[] = [];
    const stop = onPlanRequired(detail => seen.push(detail));
    const error = await choosePayer('uonify_tokens').catch(reason => reason);
    stop();
    expect(error).toMatchObject({ status: 402, data: { error: 'plan_required', feature: 'uony_tokens' } });
    expect(seen).toEqual([{ code: 'plan_required', feature: 'uony_tokens', message: 'Para seguir con tokens de Uonify necesitas un plan de Uonify.' }]);
    expect((await getUsage()).payer).toBe('chatgpt'); // nada cambia sin plan
  });

  it('con plan, los tokens de Uonify valen para la sesión: Uony responde y descuenta tokens', async () => {
    await setLimitSimulation({ limitReached: true, hasPlan: true });
    const chosen = await choosePayer('uonify_tokens');
    expect(chosen).toMatchObject({ payer: 'uonify_tokens', scope: 'session', usage: { payer: 'uonify_tokens' } });
    const result = await postAssistantMessage(message);
    expect(result.charged).toEqual({ tokens: 4, amount: 0.04, currency: 'EUR' });
    expect(await getLimitSimulation()).toMatchObject({ limitReached: true, hasPlan: true });
  });

  it('el precio de un mensaje depende del modelo, el esfuerzo y la velocidad', async () => {
    expect(await getTokenQuote({ model: 'auto', effort: 'high', speed: 'fast' })).toEqual({ tokens: 12, amount: 0.12, currency: 'EUR' });
  });

  it('una forma de pago desconocida es un 400', async () => {
    const error = await api.post('/ai/payer', { payer: 'otra' }).catch(reason => reason);
    expect(error).toMatchObject({ status: 400, data: { error: 'invalid_payer' } });
  });
});
