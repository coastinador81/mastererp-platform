import { useSession } from '@/modules/auth';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { billingApi } from '../api/billingApi';
import type { BillingInterval, PlanId } from '../model/plans';

/**
 * Estado de servidor de facturación (TanStack Query). Todas las claves empiezan
 * por «billing» para refrescarlo todo de una vez tras un cobro.
 */
export const billingKeys = {
  all: ['billing'] as const,
  plans: ['billing', 'plans'] as const,
  config: ['billing', 'config'] as const,
  subscription: ['billing', 'subscription'] as const,
  balance: ['billing', 'balance'] as const,
  movements: (limit: number) => ['billing', 'movements', limit] as const,
  invoices: ['billing', 'invoices'] as const,
  paymentMethod: ['billing', 'payment-method'] as const,
  withdrawal: ['billing', 'withdrawal'] as const,
  checkout: (planId: PlanId, interval: BillingInterval) => ['billing', 'checkout', planId, interval] as const,
};

/** Tras cobrar, devolver o cambiar algo: vuelve a pedir todo lo de facturación. */
export function refreshBilling(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: billingKeys.all });
}

/** Precio del token, recarga mínima, importe de «Apoya a Uonify» e IVA. */
export function useBillingConfig() {
  return useQuery({ queryKey: billingKeys.config, queryFn: billingApi.config, staleTime: 5 * 60_000 });
}

export function useSubscription() {
  return useQuery({ queryKey: billingKeys.subscription, queryFn: billingApi.subscription });
}

/** Tokens de Uonify: total, € y subcuentas (incluidos en el plan y recargados). */
export function useBalance() {
  return useQuery({ queryKey: billingKeys.balance, queryFn: billingApi.balance });
}

export function useMovements(limit: number) {
  return useQuery({ queryKey: billingKeys.movements(limit), queryFn: () => billingApi.movements(limit) });
}

export function useInvoices() {
  return useQuery({ queryKey: billingKeys.invoices, queryFn: billingApi.invoices });
}

export function usePaymentMethod() {
  const { user } = useSession();
  return useQuery({ queryKey: [...billingKeys.paymentMethod, user?.email], queryFn: billingApi.paymentMethod });
}

export function useWithdrawalPreview() {
  return useQuery({ queryKey: billingKeys.withdrawal, queryFn: billingApi.withdrawalPreview, staleTime: 0 });
}

export function useCheckoutPreview(planId: PlanId, interval: BillingInterval) {
  return useQuery({ queryKey: billingKeys.checkout(planId, interval), queryFn: () => billingApi.checkoutPreview(planId, interval), staleTime: 0 });
}
