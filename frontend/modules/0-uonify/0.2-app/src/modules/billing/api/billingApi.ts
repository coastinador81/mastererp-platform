import type { WorkspaceAccess } from '../model/access';
import { api } from '@/shared/api/client';
import type { BillingPlan, BillingInterval, PlanId } from '../model/plans';
import type {
  BillingBalance,
  BillingConfig,
  BillingDocument,
  CheckoutQuote,
  CheckoutRequest,
  CheckoutResult,
  Movement,
  PaymentDetails,
  PaymentMethod,
  RechargeResult,
  Subscription,
  SupportResult,
  WithdrawalPreview,
  WithdrawalResult,
} from '../model/types';

/**
 * Llamadas de facturación (contrato del backend; rutas bajo API_BASE). Stripe lo
 * llama el servidor: el navegador nunca ve claves ni números de tarjeta completos.
 * Contrato detallado en mocks/handlers.ts y mocks/accountHandlers.ts.
 */
export const billingApi = {
  workspaceAccess: () => api.get<WorkspaceAccess>('/billing/workspace-access'),
  plans: () => api.get<{ plans: BillingPlan[] }>('/billing/plans').then(r => r.plans),
  updatePlan: (id: PlanId, patch: Partial<Omit<BillingPlan, 'id'>>) =>
    api.put<{ plan: BillingPlan }>(`/billing/plans/${id}`, patch).then(r => r.plan),

  config: () => api.get<{ config: BillingConfig }>('/billing/config').then(r => r.config),
  updateConfig: (patch: Partial<BillingConfig>) => api.put<{ config: BillingConfig }>('/billing/config', patch).then(r => r.config),

  subscription: () => api.get<{ subscription: Subscription }>('/billing/subscription').then(r => r.subscription),
  scheduleChange: (scheduledPlanId: PlanId | null, scheduledInterval?: BillingInterval) =>
    api.put<{ subscription: Subscription }>('/billing/subscription', { scheduledPlanId, scheduledInterval }).then(r => r.subscription),

  checkoutPreview: (planId: PlanId, interval: BillingInterval = 'annual') =>
    api.get<{ quote: CheckoutQuote }>('/billing/checkout/preview', { params: { planId, interval } }).then(r => r.quote),
  checkout: (body: CheckoutRequest) => api.post<CheckoutResult>('/billing/checkout', body),

  withdrawalPreview: () => api.get<{ withdrawal: WithdrawalPreview }>('/billing/withdrawal').then(r => r.withdrawal),
  withdraw: () => api.post<WithdrawalResult>('/billing/withdrawal', { confirm: true }),

  balance: () => api.get<BillingBalance>('/billing/balance'),
  movements: (limit: number) => api.get<{ movements: Movement[]; total: number }>('/billing/movements', { params: { limit } }),
  recharge: (amount: number, details: PaymentDetails) => api.post<RechargeResult>('/billing/recharge', { amount, ...details }),

  paymentMethod: () => api.get<{ paymentMethod: PaymentMethod | null }>('/billing/payment-method').then(r => r.paymentMethod),
  replacePaymentMethod: (newCard: PaymentMethod) =>
    api.put<{ paymentMethod: PaymentMethod }>('/billing/payment-method', { source: 'stripe_setup_intent', newCard }).then(r => r.paymentMethod),

  invoices: () => api.get<{ invoices: BillingDocument[] }>('/billing/invoices').then(r => r.invoices),
  invoicePdf: (id: string) => api.get<Blob>(`/billing/invoices/${id}/pdf`, { responseType: 'blob' }),

  startSupport: (details: PaymentDetails) => api.post<SupportResult>('/billing/support', details),
  stopSupport: () => api.delete<{ subscription: Subscription }>('/billing/support').then(r => r.subscription),
};
