import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auditApi, fetchMetrics, financeApi, providersApi } from '../api/adminApi';
import type { AiProvider, MetricsRange, ProviderId, ProviderPatch } from '../model/types';
import { ADMIN_KEY, ADMIN_META } from './useAdminSession';

const auditKey = [ADMIN_KEY, 'audit'] as const;

export function useMetrics(range: MetricsRange) {
  return useQuery({ queryKey: [ADMIN_KEY, 'metrics', range], queryFn: () => fetchMetrics(range), placeholderData: keepPreviousData });
}

export function useProviders() {
  return useQuery({ queryKey: [ADMIN_KEY, 'providers'], queryFn: providersApi.list });
}

export function useUpdateProvider() {
  const client = useQueryClient();
  return useMutation({
    meta: ADMIN_META,
    mutationFn: ({ id, patch }: { id: ProviderId; patch: ProviderPatch }) => providersApi.update(id, patch),
    onSuccess: provider => {
      client.setQueryData<AiProvider[]>([ADMIN_KEY, 'providers'], list => list?.map(item => (item.id === provider.id ? provider : item)));
      void client.invalidateQueries({ queryKey: auditKey });
    },
  });
}

export function useAudit(filters: { q: string; action: string; actor: string }) {
  return useQuery({ queryKey: [...auditKey, filters], queryFn: () => auditApi.list(filters), placeholderData: keepPreviousData });
}

export function useInvoices(q: string, status: string) {
  return useQuery({ queryKey: [ADMIN_KEY, 'finance', 'invoices', q, status], queryFn: () => financeApi.invoices(q, status), placeholderData: keepPreviousData });
}

export function useWithdrawals() {
  return useQuery({ queryKey: [ADMIN_KEY, 'finance', 'withdrawals'], queryFn: financeApi.withdrawals });
}

export function useCreditNotes() {
  return useQuery({ queryKey: [ADMIN_KEY, 'finance', 'credit-notes'], queryFn: financeApi.creditNotes });
}

export function useRetryWithdrawal() {
  const client = useQueryClient();
  return useMutation({
    meta: ADMIN_META,
    mutationFn: ({ id, reason }: { id: string; reason: string }) => financeApi.retryWithdrawal(id, reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [ADMIN_KEY, 'finance'] });
      void client.invalidateQueries({ queryKey: auditKey });
    },
  });
}
