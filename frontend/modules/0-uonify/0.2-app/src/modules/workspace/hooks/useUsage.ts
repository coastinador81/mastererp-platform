import { USE_MOCKS } from '@/shared/api/config';
import { useQuery } from '@tanstack/react-query';
import { getUsage } from '../api/assistant';
import { summarizeUsage, type UsageSummary } from '../model/usage';
import { USAGE_QUERY_KEY } from './limitActions';

/** Límites de uso del compositor del espacio (la portada no tiene indicador). */
export function useUsage(): UsageSummary {
  const { data } = useQuery({
    queryKey: USAGE_QUERY_KEY,
    queryFn: ({ signal }) => getUsage(signal),
    retry: false,
    enabled: USE_MOCKS,
  });
  return summarizeUsage(data ?? null);
}
