import { useQuery } from '@tanstack/react-query';
import { billingApi } from '../api/billingApi';
import { billingKeys } from './useBilling';

/** Catálogo de planes (GET /api/billing/plans), ordenado de Gratis a Personalizado. */
export function usePlans() {
  return useQuery({
    queryKey: billingKeys.plans,
    queryFn: billingApi.plans,
    staleTime: 5 * 60_000,
  });
}
