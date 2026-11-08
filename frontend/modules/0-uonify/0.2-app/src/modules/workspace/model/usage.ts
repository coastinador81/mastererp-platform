/**
 * Límites de uso del compositor (composer-tools.js, `renderUsage`). Acepta los
 * límites del plan (`limits: [{ label, usedPercent, reset | resetText }]`) y los
 * campos de límite de la API de OpenAI (remaining/limit de tokens y solicitudes).
 * No inventa datos: sin datos, el anillo queda vacío y el panel lo dice.
 */
export interface UsageLimit {
  label: string;
  usedPercent: number;
  /** Duración: se lee «en 2 h 46 min». */
  reset?: string;
  /** Fecha como frase completa: «el mié, 3:00». */
  resetText?: string;
  /** Duración de la ventana en minutos (300 = 5 horas, 10080 = semanal). */
  windowMinutes?: number;
  /** Momento del reinicio, en segundos Unix (como `rateLimits` de Codex). */
  resetsAt?: number;
}

/** Quién paga lo que hace Uony: el plan de ChatGPT del cliente o sus tokens de Uonify. */
export type AiPayer = 'chatgpt' | 'uonify_tokens';

export interface UsageData {
  plan?: string;
  model?: string;
  /** Límites del plan de ChatGPT, de la ventana más corta a la más larga. */
  limits?: UsageLimit[];
  /** Forma de pago de Uony en esta sesión. Solo cambia cuando el cliente lo elige. */
  payer?: AiPayer;
  /** Algún límite del plan de ChatGPT está agotado. */
  limitReached?: boolean;
  /** El límite agotado es una simulación (versión de revisión y datos simulados). */
  simulated?: boolean;
  remainingTokens?: number;
  tokenLimit?: number;
  resetTokens?: string;
  remainingRequests?: number;
  requestLimit?: number;
  resetRequests?: string;
}

export interface UsageRow {
  label: string;
  used: number;
  reset: string;
  detail?: string;
}

export function compactNumber(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('es-ES', { notation: number >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(number);
}

export function usagePercent(remaining: unknown, limit: unknown): number | null {
  const max = Number(limit);
  const left = Number(remaining);
  return Number.isFinite(max) && max > 0 && Number.isFinite(left) ? Math.max(0, Math.min(100, (left / max) * 100)) : null;
}

export function usageRows(usage: UsageData): UsageRow[] {
  const rows: UsageRow[] = Array.isArray(usage.limits)
    ? usage.limits.map(limit => ({
        label: String(limit.label || ''),
        used: Number.isFinite(Number(limit.usedPercent)) ? Math.max(0, Math.min(100, Number(limit.usedPercent))) : Number.NaN,
        reset: limit.resetText || (limit.reset ? `en ${limit.reset}` : ''),
      }))
    : [];
  const tokens = usagePercent(usage.remainingTokens, usage.tokenLimit);
  const requests = usagePercent(usage.remainingRequests, usage.requestLimit);
  if (tokens !== null) rows.push({ label: 'Tokens', used: 100 - tokens, reset: usage.resetTokens ? `en ${usage.resetTokens}` : '', detail: `${compactNumber(usage.remainingTokens)} de ${compactNumber(usage.tokenLimit)} disponibles` });
  if (requests !== null) rows.push({ label: 'Solicitudes', used: 100 - requests, reset: usage.resetRequests ? `en ${usage.resetRequests}` : '', detail: `${compactNumber(usage.remainingRequests)} de ${compactNumber(usage.requestLimit)} disponibles` });
  return rows.filter(row => row.label && Number.isFinite(row.used));
}

export interface UsageSummary {
  usage: UsageData | null;
  rows: UsageRow[];
  /** El límite más gastado (anillo y etiqueta), o null sin datos. */
  main: number | null;
  label: string;
  ariaLabel: string;
  tooltip: string;
  heading: string;
}

export function summarizeUsage(data: unknown): UsageSummary {
  const usage = data && typeof data === 'object' ? (data as UsageData) : null;
  const rows = usage ? usageRows(usage) : [];
  const main = rows.length ? Math.max(...rows.map(row => row.used)) : null;
  const percent = main === null ? null : Math.round(main);
  return {
    usage,
    rows,
    main,
    label: percent === null ? 'Uso' : `${percent}%`,
    ariaLabel: percent === null ? 'Límites de uso de OpenAI' : `Límites de uso de OpenAI: ${percent} % usado`,
    tooltip: percent === null ? 'Límites de uso' : `Límites de uso · ${percent} % usado`,
    heading: `Límites de uso${usage?.plan ? ` del plan · ${usage.plan}` : ' · OpenAI'}`,
  };
}
