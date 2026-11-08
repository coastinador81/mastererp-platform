import { useQuery } from '@tanstack/react-query';
import { amazonApi } from '../api/amazonApi';

export const amazonConnectionKey = (account: string) => ['amazon-connection', account];

export function useAmazonConnection(account: string) {
  return useQuery({ queryKey: amazonConnectionKey(account), queryFn: ({ signal }) => amazonApi.state(signal), enabled: !!account, retry: false, staleTime: 0, gcTime: 0 });
}
