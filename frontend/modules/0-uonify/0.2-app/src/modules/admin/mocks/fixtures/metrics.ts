import type { AdminMetrics, MetricsRange } from '../../model/types';

/**
 * Cuadro del negocio simulado. Modelo de suscripción (sin tokens): Uonify cobra la
 * suscripción (9,90 €/mes · 118,80 €/año + IVA) y el cliente paga su consumo de IA
 * desde su propia cuenta de Google. El «coste de operación» es lo que paga Uonify
 * (soporte Uony, voz, infraestructura), no el consumo del cliente. El MRR y las bajas
 * salen de Stripe; son una foto del momento (no cambian con el periodo).
 */
const BY_STATE: AdminMetrics['byPlan'] = [
  { planId: 'trial', name: 'En prueba (14 días)', accounts: 34 },
  { planId: 'monthly', name: 'Suscripción mensual', accounts: 29 },
  { planId: 'annual', name: 'Suscripción anual', accounts: 12 },
  { planId: 'expired', name: 'Prueba caducada', accounts: 40 },
  { planId: 'none', name: 'Sin suscripción', accounts: 241 },
];

export const METRICS: Record<MetricsRange, AdminMetrics> = {
  '7d': {
    range: '7d',
    kpis: { signups: 38, activeAccounts: 212, paidAccounts: 41, trialAccounts: 34, conversionRate: 0.38, churnRate: 0.021, mrrEur: 4310, operationCostEur: 180, videosGenerated: 146, videosFailed: 7, openTickets: 9 },
    previous: { signups: 31, activeAccounts: 198, paidAccounts: 37, mrrEur: 3980 },
    byPlan: BY_STATE,
  },
  '30d': {
    range: '30d',
    kpis: { signups: 142, activeAccounts: 356, paidAccounts: 41, trialAccounts: 34, conversionRate: 0.41, churnRate: 0.028, mrrEur: 4310, operationCostEur: 760, videosGenerated: 588, videosFailed: 31, openTickets: 9 },
    previous: { signups: 109, activeAccounts: 301, paidAccounts: 33, mrrEur: 3410 },
    byPlan: BY_STATE,
  },
  '12m': {
    range: '12m',
    kpis: { signups: 356, activeAccounts: 356, paidAccounts: 41, trialAccounts: 34, conversionRate: 0.44, churnRate: 0.035, mrrEur: 4310, operationCostEur: 9120, videosGenerated: 2460, videosFailed: 118, openTickets: 9 },
    previous: { signups: 0, activeAccounts: 0, paidAccounts: 0, mrrEur: 0 },
    byPlan: BY_STATE,
  },
};
