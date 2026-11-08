import { api } from '@/shared/api/client';
import { stripeDiagnostic } from '../model/embeddedDiagnostic';
import type { CheckoutFailureCode, CheckoutPhase } from '../model/embeddedFailure';

/** Diagnóstico no autoritativo: no inicia, confirma ni reintenta un pago. */
export function reportStripeFailure(checkoutAttemptId: string | undefined, phase: CheckoutPhase, category: CheckoutFailureCode, error: unknown, secrets: string[]) {
  if (!checkoutAttemptId) return;
  const detail = stripeDiagnostic(error, secrets);
  void api.post('/billing/checkout-diagnostics', { checkoutAttemptId, phase, category, ...detail, message: detail.message || '[No message]' }, { signal: AbortSignal.timeout(5000) }).catch(() => {});
}
