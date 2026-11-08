import type { AiPayer, UsageData } from '../model/usage';

/**
 * Simulación del consumo de IA del espacio (lo que medirá el backend con
 * `account/rateLimits/read` de Codex): una ventana de 5 horas y otra semanal, en
 * porcentaje del plan de ChatGPT. Cada petición gasta según su esfuerzo y su
 * velocidad. Si el cliente elige seguir con tokens de Uonify, el plan de ChatGPT
 * deja de gastarse y cada mensaje cuesta tokens.
 */
export interface UsageState {
  plan: string;
  fiveHourUsed: number;
  fiveHourStartedAt: number;
  weeklyUsed: number;
  requests: number;
  /** Forma de pago de Uony en esta sesión (solo cambia con el clic del cliente). */
  payer?: AiPayer;
  /** Interruptor de la simulación: el límite semanal aparece agotado. */
  simulatedLimit?: boolean;
  /** La cuenta tiene un plan de Uonify (sin plan, los tokens de Uonify piden uno). */
  hasPlan?: boolean;
}

const FIVE_HOURS = 5 * 60 * 60 * 1000;
const EFFORT_COST: Record<string, number> = { low: 0.4, medium: 0.8, high: 1.5, xhigh: 2.5, max: 4 };
/** Tokens de Uonify por mensaje según el esfuerzo (100 tokens = 1 €, con el margen incluido). */
const EFFORT_TOKENS: Record<string, number> = { low: 2, medium: 4, high: 8, xhigh: 14, max: 24 };
const MODEL_FACTOR: Record<string, number> = { 'gpt-6-astra': 1.5, 'gpt-6-sol': 1.25 };
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function initialUsage(now = Date.now()): UsageState {
  // Una ventana ya empezada: se restablece en 2 h 46 min, como el ejemplo del PROTO.
  return {
    plan: 'Free',
    fiveHourUsed: 6,
    fiveHourStartedAt: now - (FIVE_HOURS - (2 * 60 + 46) * 60 * 1000),
    weeklyUsed: 26,
    requests: 0,
    payer: 'chatgpt',
    simulatedLimit: false,
    hasPlan: false,
  };
}

/** La ventana de 5 horas vuelve a cero al terminar. */
export function rollWindow(state: UsageState, now = Date.now()): UsageState {
  if (now - state.fiveHourStartedAt < FIVE_HOURS) return state;
  return { ...state, fiveHourUsed: 0, fiveHourStartedAt: now };
}

export function payerOf(state: UsageState): AiPayer {
  return state.payer === 'uonify_tokens' ? 'uonify_tokens' : 'chatgpt';
}

/** Algún límite del plan de ChatGPT está agotado (o se simula). */
export function limitReached(state: UsageState, now = Date.now()): boolean {
  const current = rollWindow(state, now);
  return Boolean(current.simulatedLimit) || current.fiveHourUsed >= 100 || current.weeklyUsed >= 100;
}

/** Uony no puede responder con ChatGPT y el cliente no ha elegido pagar con tokens. */
export function blocked(state: UsageState, now = Date.now()): boolean {
  return payerOf(state) === 'chatgpt' && limitReached(state, now);
}

export function consume(state: UsageState, effort: string, speed: string, now = Date.now()): UsageState {
  const current = rollWindow(state, now);
  // Con tokens de Uonify, el plan de ChatGPT no se gasta.
  if (payerOf(current) === 'uonify_tokens') return { ...current, requests: current.requests + 1 };
  const cost = (EFFORT_COST[effort] ?? EFFORT_COST.medium) * (speed === 'fast' ? 1.5 : 1);
  return {
    ...current,
    fiveHourUsed: Math.min(100, Math.round((current.fiveHourUsed + cost) * 10) / 10),
    weeklyUsed: Math.min(100, Math.round((current.weeklyUsed + cost / 4) * 10) / 10),
    requests: current.requests + 1,
  };
}

/** Precio de un mensaje con tokens de Uonify: { tokens, amount, currency }. */
export function tokenCost(model: string, effort: string, speed: string): { tokens: number; amount: number; currency: string } {
  const base = EFFORT_TOKENS[effort] ?? EFFORT_TOKENS.medium;
  const tokens = Math.max(1, Math.round(base * (MODEL_FACTOR[model] ?? 1) * (speed === 'fast' ? 1.5 : 1)));
  return { tokens, amount: tokens / 100, currency: 'EUR' };
}

function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/** Próximo miércoles a las 3:00 (reinicio semanal). */
function weeklyResetDate(now: number): Date {
  const date = new Date(now);
  const next = new Date(date);
  next.setHours(3, 0, 0, 0);
  const days = (3 - date.getDay() + 7) % 7;
  next.setDate(date.getDate() + (days === 0 && date >= next ? 7 : days));
  return next;
}

export function weeklyReset(now: number): string {
  return `el ${WEEKDAYS[weeklyResetDate(now).getDay()]}, 3:00`;
}

export function toUsageData(state: UsageState, now = Date.now()): UsageData {
  const current = rollWindow(state, now);
  const fiveHourEnd = current.fiveHourStartedAt + FIVE_HOURS;
  return {
    plan: current.plan,
    payer: payerOf(current),
    limitReached: limitReached(current, now),
    simulated: Boolean(current.simulatedLimit),
    limits: [
      { label: 'Límite de 5 horas', usedPercent: current.fiveHourUsed, reset: duration(fiveHourEnd - now), windowMinutes: 300, resetsAt: Math.round(fiveHourEnd / 1000) },
      {
        label: 'Semanal · todos los modelos',
        usedPercent: current.simulatedLimit ? 100 : current.weeklyUsed,
        resetText: weeklyReset(now),
        windowMinutes: 10080,
        resetsAt: Math.round(weeklyResetDate(now).getTime() / 1000),
      },
    ],
  };
}

/** Cuándo vuelve el plan de ChatGPT (para el mensaje del 429). */
export function resetOf(state: UsageState, now = Date.now()): string {
  const current = rollWindow(state, now);
  if (current.simulatedLimit || current.weeklyUsed >= 100) return weeklyReset(now);
  return `en ${duration(current.fiveHourStartedAt + FIVE_HOURS - now)}`;
}
