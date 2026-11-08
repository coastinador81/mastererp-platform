import { api } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import type { PlanRequiredCode } from '@/shared/api/planRequired';

/**
 * Ayudantes de desarrollo y pruebas (solo con la simulación MSW). Piden a un
 * endpoint simulado que responda 402, así el recorrido es el real: cliente HTTP →
 * bus @/shared/api/planRequired → <PaywallHost/>.
 *
 *   await triggerPaywall('plan_required', 'video');
 *   await triggerPaywall('tokens_required', 'descriptions');
 */
export async function triggerPaywall(code: PlanRequiredCode, feature = 'video', message?: string): Promise<void> {
  if (!USE_MOCKS) return;
  await api.post('/billing/dev/paywall', { code, feature, message }).catch(() => undefined);
}

/** Simula un consumo de tokens de Uonify (primero los del plan, después los recargados). */
export async function simulateTokenSpend(tokens: number, concept = 'Consumo de Uony', feature = 'uony'): Promise<void> {
  if (!USE_MOCKS) return;
  await api.post('/billing/dev/spend', { tokens, concept, feature }).catch(() => undefined);
}

declare global {
  interface Window {
    /** Solo en desarrollo con la simulación: probar el muro de pago desde la consola. */
    uonifyBilling?: { triggerPaywall: typeof triggerPaywall; simulateTokenSpend: typeof simulateTokenSpend };
  }
}

/** Deja los ayudantes en window.uonifyBilling (solo desarrollo con MSW). */
export function exposeDevHelpers(): void {
  if (!import.meta.env.DEV || !USE_MOCKS || typeof window === 'undefined') return;
  window.uonifyBilling = { triggerPaywall, simulateTokenSpend };
}
