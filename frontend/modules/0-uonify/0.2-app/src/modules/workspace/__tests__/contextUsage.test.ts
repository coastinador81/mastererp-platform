import { contextPercentage, contextSummary } from '../model/contextUsage';
import type { ContextMeasurement } from '../api/contextUsage';

const measured = (usedTokens: number): ContextMeasurement => ({ status: 'measured', usedTokens, limitTokens: 1000,
  remainingTokens: Math.max(0, 1000 - usedTokens), usageRatio: usedTokens / 1000, model: 'gemini-test', modelLabel: 'Gemini',
  measuredAt: '2026-10-15T12:00:00Z', historyTurns: 2, historyLimit: 12, measurement: 'google_count_tokens' });

it.each([[0, 'normal'], [749, 'normal'], [750, 'warning'], [899, 'warning'], [900, 'critical'], [1000, 'critical']])(
  'colorea %i tokens según la capacidad real', (used, tone) => {
    expect(contextSummary(measured(Number(used)))?.tone).toBe(tone);
  });
it('limita el dibujo al 100 % conservando el exceso numérico real', () => {
  expect(contextSummary(measured(1200))).toMatchObject({ percentage: 120, ringPercentage: 100, used: 1200, remaining: 0 });
});
it('no inventa un cero con errores, ausencia de medición o números inválidos', () => {
  expect(contextSummary(undefined)).toBeNull();
  expect(contextSummary({ ...measured(1), status: 'unavailable' })).toBeNull();
  expect(contextSummary({ ...measured(1), measurement: null })).toBeNull();
  expect(contextSummary({ ...measured(1), limitTokens: 0 })).toBeNull();
  expect(contextSummary({ ...measured(1), usedTokens: Number.NaN })).toBeNull();
  expect(contextSummary({ ...measured(1), usedTokens: -1 })).toBeNull();
});
it('un contexto pequeño mantiene porcentaje visible sin redondearlo a cero', () => {
  expect(contextPercentage(0.06)).toBe('0,06');
});
