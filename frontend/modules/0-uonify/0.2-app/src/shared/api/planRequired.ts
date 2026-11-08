/**
 * Muro de pago. Cuando una acción cuesta dinero a Uonify y la cuenta no tiene plan (o
 * no le quedan tokens de Uonify), el backend responde 402 con
 * { error: 'plan_required' | 'tokens_required', message, feature }.
 * El cliente HTTP lo anuncia aquí, y el módulo billing (<PaywallHost/>) abre el aviso.
 * Nunca se cambia de forma de pago en silencio: el cliente siempre elige.
 */
export type PlanRequiredCode = 'plan_required' | 'tokens_required';

export interface PlanRequiredDetail {
  code: PlanRequiredCode;
  /** Qué intentaba hacer el cliente (p. ej. «video», «aplus», «download»). */
  feature?: string;
  message?: string;
}

const EVENT = 'uonify:plan-required';

export function emitPlanRequired(detail: PlanRequiredDetail): void {
  window.dispatchEvent(new CustomEvent<PlanRequiredDetail>(EVENT, { detail }));
}

export function onPlanRequired(handler: (detail: PlanRequiredDetail) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<PlanRequiredDetail>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** Lee un cuerpo de error 402 del backend; null si no es un muro de pago. */
export function planRequiredFrom(status: number, data: unknown): PlanRequiredDetail | null {
  if (status !== 402 || !data || typeof data !== 'object') return null;
  const body = data as { error?: unknown; message?: unknown; feature?: unknown };
  if (body.error !== 'plan_required' && body.error !== 'tokens_required') return null;
  return {
    code: body.error,
    message: typeof body.message === 'string' ? body.message : undefined,
    feature: typeof body.feature === 'string' ? body.feature : undefined,
  };
}
