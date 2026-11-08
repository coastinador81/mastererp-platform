import { useQuery } from '@tanstack/react-query';
import { useOwnedRequest } from '@/shared/hooks';
import { api } from '@/shared/api/client';
import { currentAccountEmail } from '../state/session';
import type { ActivationState } from '../model/activation';

export function useActivationSetup(account: string) {
  const owner = useOwnedRequest(account, currentAccountEmail);
  const query = useQuery({ queryKey: ['onboarding-setup', account], retry: false, staleTime: 0,
    queryFn: ({ signal }) => owner.read(inner => api.get<ActivationState>('/onboarding/setup', { signal: inner }), signal),
    refetchOnWindowFocus: true,
  });
  const saveIntent = async (firstIntent: string) => {
    const task = owner.begin(); if (!task) throw new Error('Tu sesión ha cambiado.');
    try {
      await api.put('/onboarding/setup', { firstIntent }, { signal: task.signal }); task.check();
      await query.refetch({ throwOnError: true }); task.check();
    } finally { task.finish(); }
  };
  return { ...query, saveIntent };
}
