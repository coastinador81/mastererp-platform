import { summarizeUsage, type AiPayer, type UsageData } from './usage';

/**
 * Límite del plan de ChatGPT (decisión del dueño, 27-09-2026). Con ChatGPT conectado,
 * Uony trabaja con el plan del cliente. Al agotarlo, el cliente elige: esperar a que
 * se restablezca o seguir con sus tokens de Uonify solo durante la sesión. Nunca se
 * cambia de forma de pago en silencio. Lógica pura, sin React.
 */
export const USAGE_LIMIT_ERROR = 'subscription_sharing_usage_limit_exceeded';

/** Por qué se abre el aviso: el uso llegó al 100 %, se intentó enviar o el servidor lo rechazó. */
export type LimitReason = 'usage' | 'send' | 'rejected';

/** Tokens de Uonify por euro («1.250 tokens · 12,50 €»). */
export const TOKENS_PER_EURO = 100;

export interface UsageLimitInfo {
  reached: boolean;
  /** Nombre del límite agotado («Semanal · todos los modelos»). */
  label: string;
  /** Cuándo vuelve: «el mié, 3:00» o «en 2 h 46 min». */
  reset: string;
  payer: AiPayer;
  simulated: boolean;
}

export function limitInfo(data: UsageData | null | undefined): UsageLimitInfo {
  const { usage, rows } = summarizeUsage(data ?? null);
  // Los límites llegan de la ventana más corta a la más larga: manda el último agotado.
  const exhausted = rows.filter(row => row.used >= 100).at(-1);
  return {
    reached: Boolean(usage?.limitReached) || Boolean(exhausted),
    label: exhausted?.label ?? '',
    reset: exhausted?.reset ?? '',
    payer: usage?.payer === 'uonify_tokens' ? 'uonify_tokens' : 'chatgpt',
    simulated: Boolean(usage?.simulated),
  };
}

/** Uony no puede responder con ChatGPT y el cliente aún no ha elegido otra forma de pago. */
export function blockedByLimit(data: UsageData | null | undefined): boolean {
  const info = limitInfo(data);
  return info.reached && info.payer === 'chatgpt';
}

/** Frase de la descripción del aviso. */
export function limitSentence(info: Pick<UsageLimitInfo, 'label' | 'reset'>): string {
  const which = info.label ? ` (${info.label.toLowerCase()})` : '';
  const when = info.reset ? ` Se restablece ${info.reset}.` : ' Se restablecerá en cuanto termine su periodo.';
  return `Has usado todo el límite de tu plan de ChatGPT${which}.${when}`;
}

export interface TokenAmount {
  tokens: number;
  amount: number;
  currency: string;
}

const tokensFormat = new Intl.NumberFormat('es-ES', { useGrouping: 'always', maximumFractionDigits: 0 });

export function formatMoney(amount: number, currency = 'EUR'): string {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** «1.250 tokens · 12,50 €» (el saldo siempre con su valor en euros al lado). */
export function formatTokens({ tokens, amount, currency }: TokenAmount): string {
  return `${tokensFormat.format(tokens)} ${tokens === 1 ? 'token' : 'tokens'} · ${formatMoney(amount, currency)}`;
}

const finite = (value: unknown): number | null => {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number) ? number : null;
};

/**
 * Lee un saldo o un precio del backend: `{ tokens, amount, currency }`, o solo el
 * importe (`amount` o `balance`, forma de GET /billing/balance). null si no se entiende.
 */
export function readTokenAmount(data: unknown): TokenAmount | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as Record<string, unknown>;
  const tokens = finite(body.tokens);
  const amount = finite(body.amount ?? body.balance);
  if (tokens === null && amount === null) return null;
  const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'EUR';
  return {
    tokens: tokens ?? Math.round((amount ?? 0) * TOKENS_PER_EURO),
    amount: amount ?? (tokens ?? 0) / TOKENS_PER_EURO,
    currency,
  };
}

/** Error 429 del servidor de Uony: el plan de ChatGPT del cliente llegó a su límite. */
export function isUsageLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, data } = error as { status?: unknown; data?: unknown };
  return status === 429 && Boolean(data) && typeof data === 'object' && (data as { error?: unknown }).error === USAGE_LIMIT_ERROR;
}
