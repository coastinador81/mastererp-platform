import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';

/** La reentrada se deriva del acceso confirmado por el servidor, no de un paso local. */
export function useSetupStage(account: string, enabled: boolean) {
  const [reviewSubscription, setReviewSubscription] = useState(false);
  const access = useQuery({
    queryKey: ['onboarding-access', account], enabled, retry: false, staleTime: 0,
    queryFn: async () => {
      if (new URLSearchParams(window.location.search).get('billing') === 'return') {
        await api.post('/billing/subscription/refresh', {}, { signal: AbortSignal.timeout(30_000) });
      }
      return api.get<{ status: string }>('/billing/workspace-access');
    },
  });
  const google = access.data?.status === 'allowed' && !reviewSubscription;
  return { google, access, review: () => setReviewSubscription(true), next: async () => {
    await access.refetch({ throwOnError: true }); setReviewSubscription(false);
  } };
}
