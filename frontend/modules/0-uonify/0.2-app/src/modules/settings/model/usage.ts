import { formatCountdown } from './format';

/**
 * Lectura de Uso. Los límites de ChatGPT llegan de GET /ai/usage (módulo workspace)
 * y el saldo y los movimientos de GET /billing/balance y GET /billing/movements
 * (módulo billing). Se leen con tolerancia: no se inventa ningún dato que falte.
 */

export interface UsageBar {
  id: string;
  label: string;
  /** 0-100. */
  usedPercent: number;
  /** «Se restablece en 2 h 46 min» · «Se restablece el mié, 3:00» · ''. */
  resetLabel: string;
}

export interface ChatGptUsage {
  plan: string | null;
  bars: UsageBar[];
}

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Instante de reinicio en ms a partir de ISO, segundos o milisegundos. */
export function resetInstant(value: unknown): number | null {
  const number = num(value);
  if (number !== null) return number < 1e12 ? number * 1000 : number;
  const text = str(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function resetLabelFor(limit: Raw, now: number): string {
  const instant = resetInstant(limit.resetsAt ?? limit.resets_at);
  if (instant !== null) {
    if (instant - now <= 86_400_000) return `Se restablece en ${formatCountdown(instant, now)}`;
    const date = new Date(instant);
    const time = new Intl.DateTimeFormat('es-ES', { hour: 'numeric', minute: '2-digit' }).format(date);
    return `Se restablece el ${WEEKDAYS[date.getDay()]}, ${time}`;
  }
  const text = str(limit.resetText);
  if (text) return `Se restablece ${text}`;
  const duration = str(limit.reset);
  return duration ? `Se restablece en ${duration}` : '';
}

function labelFor(limit: Raw): { id: string; label: string } {
  const minutes = num(limit.windowDurationMins ?? limit.window_duration_mins);
  const raw = str(limit.label);
  if (minutes === 300 || /5\s*horas|five/i.test(raw)) return { id: 'five-hour', label: 'Sesión actual (5 horas)' };
  if (minutes === 10080 || /seman|week|seven/i.test(raw)) return { id: 'weekly', label: 'Límite semanal' };
  return { id: raw.toLowerCase().replace(/\W+/g, '-') || 'limit', label: raw || 'Límite' };
}

/** Lee la respuesta de GET /ai/usage ({ plan, limits: [{ label, usedPercent, reset | resetText | resetsAt }] }). */
export function parseChatGptUsage(data: unknown, now = Date.now()): ChatGptUsage {
  if (!isObject(data)) return { plan: null, bars: [] };
  const limits = Array.isArray(data.limits) ? data.limits.filter(isObject) : [];
  const bars = limits
    .map((limit): UsageBar | null => {
      const used = num(limit.usedPercent ?? limit.used_percentage ?? limit.usedPercentage);
      if (used === null) return null;
      const { id, label } = labelFor(limit);
      return { id, label, usedPercent: Math.max(0, Math.min(100, used)), resetLabel: resetLabelFor(limit, now) };
    })
    .filter((bar): bar is UsageBar => bar !== null);
  return { plan: str(data.plan) || null, bars };
}

/** Tono de la barra: azul normal, ámbar desde el 75 % y rojo al 100 %. */
export function usageTone(usedPercent: number): 'normal' | 'warning' | 'full' {
  if (usedPercent >= 100) return 'full';
  if (usedPercent >= 75) return 'warning';
  return 'normal';
}

// ── Tokens de Uonify ─────────────────────────────────────────────────────────

/** Valor de referencia de un token (1.250 tokens = 12,50 €) si el backend no manda el importe. */
export const TOKEN_EUR = 0.01;

export interface TokenBalance {
  tokens: number;
  euros: number;
}

/**
 * Saldo de GET /billing/balance. Admite { tokens, euros | amount | value } y el
 * formato anterior en euros ({ amount, currency: 'EUR' }).
 */
export function parseBalance(data: unknown): TokenBalance | null {
  if (!isObject(data)) return null;
  const tokens = num(data.tokens ?? data.balanceTokens ?? data.tokenBalance);
  const euros = num(data.euros ?? data.valueEur ?? data.eurValue ?? data.value ?? data.amount);
  if (tokens !== null) return { tokens, euros: euros ?? tokens * TOKEN_EUR };
  if (euros !== null) return { tokens: Math.round(euros / TOKEN_EUR), euros };
  return null;
}

export interface TokenMovement {
  id: string;
  date: string;
  concept: string;
  /** Positivo = entrada (recarga, plan); negativo = gasto. */
  tokens: number;
  euros: number;
}

/** Movimientos de GET /billing/movements ({ movements: [...] } o una lista). */
export function parseMovements(data: unknown): TokenMovement[] {
  const list = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.movements) ? data.movements : isObject(data) && Array.isArray(data.items) ? data.items : [];
  return list
    .filter(isObject)
    .map((item, index): TokenMovement | null => {
      const tokens = num(item.tokens ?? item.deltaTokens ?? item.amountTokens);
      const euros = num(item.euros ?? item.valueEur ?? item.amount ?? item.value);
      if (tokens === null && euros === null) return null;
      const signedTokens = tokens ?? Math.round((euros ?? 0) / TOKEN_EUR);
      return {
        id: str(item.id) || `mov-${index}`,
        date: str(item.date ?? item.createdAt ?? item.at),
        concept: str(item.concept ?? item.description ?? item.label ?? item.title) || 'Movimiento',
        tokens: signedTokens,
        euros: euros ?? signedTokens * TOKEN_EUR,
      };
    })
    .filter((item): item is TokenMovement => item !== null)
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
