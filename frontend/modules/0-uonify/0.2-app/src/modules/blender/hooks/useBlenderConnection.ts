import { useQuery } from '@tanstack/react-query';
import { blenderApi } from '../api/blenderApi';

export const blenderConnectionKey = (account: string, productId?: string) => ['blender-connection', account, ...(productId ? [productId] : [])];
export function useBlenderConnection(account: string, live = false, productId?: string) {
  return useQuery({
    queryKey: blenderConnectionKey(account, productId), queryFn: () => blenderApi.state(productId),
    enabled: !!account, retry: false, staleTime: 0,
    refetchInterval: live ? 15_000 : false,
  });
}
