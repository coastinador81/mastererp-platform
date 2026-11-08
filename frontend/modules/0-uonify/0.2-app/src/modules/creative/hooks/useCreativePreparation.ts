import { useQuery } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { useOwnedRequest } from '@/shared/hooks';
import { getCreativePreparation } from '../api/creativePreparation';

export interface CreativePreparationScope {
  revision?: number;
  model?: string;
}

export const creativePreparationKey = (account: string, threadId: string,
  scope: CreativePreparationScope = {}) =>
  ['creative-preparation', account, threadId, scope.revision ?? null, scope.model ?? null] as const;

export function useCreativePreparation(account: string | undefined, threadId: string | undefined,
  scope: CreativePreparationScope = {}, enabled = true) {
  const owned = useOwnedRequest(account ?? '', currentAccountEmail);
  return useQuery({
    queryKey: creativePreparationKey(account ?? '', threadId ?? '', scope),
    queryFn: async ({ signal }) => {
      const result = await owned.read(next => getCreativePreparation(threadId!, next), signal);
      if (result && ((scope.revision !== undefined && result.revision !== scope.revision)
        || (scope.model !== undefined && result.model.model !== scope.model))) {
        throw new DOMException('El plan creativo ha cambiado.', 'InvalidStateError');
      }
      return result;
    },
    enabled: enabled && !!account && !!threadId && owned.current(),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}
