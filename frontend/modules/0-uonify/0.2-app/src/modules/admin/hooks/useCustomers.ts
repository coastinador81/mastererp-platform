import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../api/adminApi';
import type { AdjustmentCategory, CustomerDetail, SuspendReason } from '../model/types';
import { ADMIN_KEY, ADMIN_META } from './useAdminSession';

const customersKey = [ADMIN_KEY, 'customers'] as const;
const auditKey = [ADMIN_KEY, 'audit'] as const;

export function useCustomerSearch(q: string, status: string) {
  return useQuery({
    queryKey: [...customersKey, 'search', q, status],
    queryFn: () => customersApi.search(q, status),
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: [...customersKey, 'detail', id],
    queryFn: () => customersApi.get(id ?? ''),
    enabled: !!id,
  });
}

/** Tras una acción: la ficha nueva en caché, la lista y la auditoría al día. */
function useApplyCustomer() {
  const client = useQueryClient();
  return (customer: CustomerDetail) => {
    client.setQueryData([...customersKey, 'detail', customer.id], customer);
    void client.invalidateQueries({ queryKey: [...customersKey, 'search'] });
    void client.invalidateQueries({ queryKey: auditKey });
  };
}

export function useCustomerActions(id: string) {
  const apply = useApplyCustomer();
  const client = useQueryClient();
  const suspend = useMutation({
    meta: ADMIN_META,
    mutationFn: (input: { category: SuspendReason; reason: string }) => customersApi.suspend(id, input.category, input.reason),
    onSuccess: apply,
  });
  const reactivate = useMutation({ meta: ADMIN_META, mutationFn: (reason: string) => customersApi.reactivate(id, reason), onSuccess: apply });
  const setAiBlocked = useMutation({
    meta: ADMIN_META,
    mutationFn: (input: { blocked: boolean; reason: string }) => customersApi.setAiBlocked(id, input.blocked, input.reason),
    onSuccess: apply,
  });
  const adjust = useMutation({
    meta: ADMIN_META,
    mutationFn: (input: { tokens: number; category: AdjustmentCategory; reason: string }) => customersApi.adjustBalance(id, input),
    onSuccess: result => apply(result.customer),
  });
  const approve = useMutation({
    meta: ADMIN_META,
    mutationFn: (entryId: string) => customersApi.approveAdjustment(id, entryId),
    onSuccess: result => apply(result.customer),
  });
  const addNote = useMutation({
    meta: ADMIN_META,
    mutationFn: (text: string) => customersApi.addNote(id, text),
    onSuccess: note => {
      client.setQueryData<CustomerDetail>([...customersKey, 'detail', id], current => (current ? { ...current, notes: [note, ...current.notes] } : current));
      void client.invalidateQueries({ queryKey: auditKey });
    },
  });
  return { suspend, reactivate, setAiBlocked, adjust, approve, addNote };
}
