import { blockedByLimit, formatTokens, isUsageLimitError, limitInfo, limitSentence, readTokenAmount, USAGE_LIMIT_ERROR } from '../model/aiLimit';
import { blocked, consume, initialUsage, limitReached, tokenCost, toUsageData } from '../mocks/usageModel';

const nbsp = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

// Límite del plan de ChatGPT: lectura del uso, textos del aviso y simulación del backend.
describe('límite del plan de ChatGPT (model/aiLimit)', () => {
  const limits = [
    { label: 'Límite de 5 horas', usedPercent: 40, reset: '2 h 46 min' },
    { label: 'Semanal · todos los modelos', usedPercent: 100, resetText: 'el mié, 3:00' },
  ];

  it('un límite al 100 % lo agota y manda el de la ventana más larga', () => {
    const info = limitInfo({ plan: 'Plus', limits });
    expect(info).toEqual({ reached: true, label: 'Semanal · todos los modelos', reset: 'el mié, 3:00', payer: 'chatgpt', simulated: false });
    expect(limitSentence(info)).toBe('Has usado todo el límite de tu plan de ChatGPT (semanal · todos los modelos). Se restablece el mié, 3:00.');
  });

  it('sin datos, o por debajo del 100 %, no hay límite; el aviso del servidor también cuenta', () => {
    expect(limitInfo(null).reached).toBe(false);
    expect(limitInfo({ limits: [{ label: 'Límite de 5 horas', usedPercent: 99.9, reset: '1 h' }] }).reached).toBe(false);
    expect(limitInfo({ limitReached: true }).reached).toBe(true);
    expect(limitSentence({ label: '', reset: '' })).toBe('Has usado todo el límite de tu plan de ChatGPT. Se restablecerá en cuanto termine su periodo.');
  });

  it('solo bloquea mientras Uony paga con ChatGPT: con tokens de Uonify sigue', () => {
    expect(blockedByLimit({ limits })).toBe(true);
    expect(blockedByLimit({ limits, payer: 'uonify_tokens' })).toBe(false);
    expect(limitInfo({ limits, payer: 'uonify_tokens', simulated: true })).toMatchObject({ payer: 'uonify_tokens', simulated: true });
  });

  it('los tokens de Uonify llevan siempre su valor en euros al lado', () => {
    expect(nbsp(formatTokens({ tokens: 1250, amount: 12.5, currency: 'EUR' }))).toBe('1.250 tokens · 12,50 €');
    expect(nbsp(formatTokens({ tokens: 1, amount: 0.01, currency: 'EUR' }))).toBe('1 token · 0,01 €');
  });

  it('lee el saldo con tokens o solo con el importe (GET /billing/balance)', () => {
    expect(readTokenAmount({ tokens: 500, amount: 5, currency: 'EUR' })).toEqual({ tokens: 500, amount: 5, currency: 'EUR' });
    expect(readTokenAmount({ amount: 60, currency: 'EUR' })).toEqual({ tokens: 6000, amount: 60, currency: 'EUR' });
    expect(readTokenAmount({ balance: 2.5 })).toEqual({ tokens: 250, amount: 2.5, currency: 'EUR' });
    expect(readTokenAmount({ tokens: 300 })).toEqual({ tokens: 300, amount: 3, currency: 'EUR' });
    expect(readTokenAmount({ amount: null })).toBeNull();
    expect(readTokenAmount('60')).toBeNull();
  });

  it('reconoce el 429 del límite y nada más', () => {
    expect(isUsageLimitError({ status: 429, data: { error: USAGE_LIMIT_ERROR } })).toBe(true);
    expect(isUsageLimitError({ status: 429, data: { error: 'rate_limited' } })).toBe(false);
    expect(isUsageLimitError({ status: 402, data: { error: USAGE_LIMIT_ERROR } })).toBe(false);
    expect(isUsageLimitError(new Error('x'))).toBe(false);
  });
});

describe('simulación del uso (mocks/usageModel)', () => {
  const now = Date.UTC(2026, 8, 28, 10, 0);

  it('el interruptor agota el límite semanal y lo marca como simulado', () => {
    const state = { ...initialUsage(now), simulatedLimit: true };
    const data = toUsageData(state, now);
    expect(data).toMatchObject({ payer: 'chatgpt', limitReached: true, simulated: true });
    expect(data.limits?.[1]).toMatchObject({ usedPercent: 100, windowMinutes: 10080 });
    expect(data.limits?.[0]).toMatchObject({ windowMinutes: 300 });
    expect(blocked(state, now)).toBe(true);
    expect(blocked({ ...state, payer: 'uonify_tokens' }, now)).toBe(false);
  });

  it('con tokens de Uonify el plan de ChatGPT no se gasta', () => {
    const start = { ...initialUsage(now), payer: 'uonify_tokens' as const };
    const next = consume(start, 'max', 'fast', now);
    expect(next.fiveHourUsed).toBe(start.fiveHourUsed);
    expect(next.requests).toBe(1);
  });

  it('gastar hasta el 100 % agota el límite de 5 horas', () => {
    const next = consume({ ...initialUsage(now), fiveHourUsed: 99.5 }, 'medium', 'standard', now);
    expect(next.fiveHourUsed).toBe(100);
    expect(limitReached(next, now)).toBe(true);
  });

  it('el precio por mensaje sube con el esfuerzo, el modo rápido y el modelo', () => {
    expect(tokenCost('auto', 'medium', 'standard')).toEqual({ tokens: 4, amount: 0.04, currency: 'EUR' });
    expect(tokenCost('auto', 'medium', 'fast').tokens).toBe(6);
    expect(tokenCost('gpt-6-astra', 'max', 'standard').tokens).toBe(36);
  });
});
