import type { ContextMeasurement } from '../api/contextUsage';

export interface ContextSummary {
  percentage: number;
  ringPercentage: number;
  tone: 'normal' | 'warning' | 'critical';
  used: number;
  limit: number;
  remaining: number;
}

/** Sin números medidos no mostrar un cero ni un porcentaje calculado del consumo. */
export function contextSummary(data: ContextMeasurement | undefined): ContextSummary | null {
  if (data?.status !== 'measured' || data.measurement !== 'google_count_tokens') return null;
  const { usedTokens: used, limitTokens: limit, remainingTokens: remaining } = data;
  if (typeof used !== 'number' || typeof limit !== 'number' || typeof remaining !== 'number'
    || !Number.isFinite(used) || !Number.isFinite(limit) || !Number.isFinite(remaining)
    || used < 0 || limit <= 0 || remaining < 0) return null;
  const percentage = used / limit * 100;
  return { used, limit, remaining, percentage, ringPercentage: Math.min(100, percentage),
    tone: percentage >= 90 ? 'critical' : percentage >= 75 ? 'warning' : 'normal' };
}

export function contextNumber(value: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' }).format(value);
}

export function contextPercentage(value: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: value > 0 && value < 1 ? 2 : 1 }).format(value);
}
