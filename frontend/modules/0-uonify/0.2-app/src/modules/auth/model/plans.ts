import type { BillingPlan, BillingInterval } from '@/modules/billing';
import type { PlanId } from './types';

/**
 * Paso «Elige tu plan». El catálogo (precios y límites editables desde admin) lo
 * da billing con usePlans(); aquí solo hay textos y lógica pura. Decisión del
 * dueño: planes mensuales y anuales, «1 mes gratis» = 13 meses por el precio de 12.
 */
export const PLAN_IDS: readonly PlanId[] = ['free', 'basic', 'pro', 'max', 'custom'];

/** Nombre corto del plan (menú de cuenta y resumen del alta). */
export const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Gratis',
  basic: 'Básico',
  pro: 'Pro',
  max: 'Max',
  custom: 'Personalizado',
};

/** Correo de ventas para el plan Personalizado. */
export const SALES_EMAIL = 'hola@uonify.com';
export const SALES_MAILTO = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Plan Personalizado de Uonify')}`;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

/** Planes guardados con el nombre anterior del prototipo («enterprise»). */
export function normalizePlan(value: unknown): PlanId | null {
  if (value === 'enterprise') return 'custom';
  return isPlanId(value) ? value : null;
}

/** Planes que se pagan con startCheckout() (Personalizado va por ventas). */
export const isPaidPlan = (plan: PlanId): boolean => plan === 'basic' || plan === 'pro' || plan === 'max';

/** «1.250 €»: euros enteros con separador de miles, como el resto de Uonify. */
export function formatEuros(amount: number): string {
  const rounded = Math.round(amount);
  return `${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`;
}

/** Precio mensual («49 €») o null en Personalizado. */
export const monthlyLabel = (plan: BillingPlan): string | null => (plan.monthlyPrice === null ? null : formatEuros(plan.monthlyPrice));

/** «588 € al año» para los de pago; '' en Gratis y Personalizado. */
export function annualLabel(plan: BillingPlan): string {
  if (!plan.monthlyPrice) return '';
  return `${formatEuros(plan.monthlyPrice * 12)} al año`;
}

/** Los anuales de pago incluyen un mes: 13 meses por el precio de 12. */
export const hasBonusMonth = (plan: BillingPlan): boolean => !!plan.monthlyPrice && plan.monthsPerYear > 12;

export const BONUS_LABEL = '13 meses por el precio de 12';

// Recomendación según el tamaño del equipo (prototipo: renderProfileStep).
const SUGGESTED_BY_SIZE: Record<string, string> = {
  '1': 'Gratis',
  '2-10': 'Básico',
  '11-50': 'Pro',
  '51-200': 'Max',
  '201+': 'un plan Personalizado',
};

/** Texto de recomendación del paso, o '' si aún no hay tamaño de equipo. */
export function planSuggestion(companySize: string): string {
  const suggested = SUGGESTED_BY_SIZE[companySize];
  return suggested ? `Por el tamaño de tu equipo, te recomendamos empezar con ${suggested}. Puedes elegir cualquier plan.` : '';
}

/** Nota bajo las tarjetas según el plan elegido. */
export function planNote(plan: PlanId | '', interval: BillingInterval = 'monthly'): string {
  if (plan === 'free') return 'Gratis no tiene coste. Puedes cambiar de plan cuando quieras.';
  if (plan === 'custom') return `Te escribiremos desde ${SALES_EMAIL} para preparar una propuesta a tu medida. Aquí no se cobra nada.`;
  return `Pago ${interval === 'monthly' ? 'mensual' : 'anual'}, impuestos no incluidos. Completa el pago para acceder a tu espacio. Tienes 14 días para desistir: te devolvemos el importe menos los tokens de Uonify que hayas gastado.`;
}

/**
 * Sin el plan de ChatGPT conectado, Uony trabaja con tokens de Uonify, y eso exige
 * un plan de pago (decisión del dueño: nunca se cambia de forma de pago en silencio).
 */
export function uonyPlanNotice(plan: PlanId | '', chatgptConnected: boolean): string {
  if (chatgptConnected) return '';
  if (plan === 'free') {
    return 'Sin tu plan de ChatGPT conectado, Uony necesita tokens de Uonify y un plan de pago. Con Gratis podrás usar Uonify, y Uony cuando conectes tu plan de ChatGPT o contrates un plan.';
  }
  return 'Sin tu plan de ChatGPT conectado, Uony usará los tokens de Uonify de tu plan.';
}
