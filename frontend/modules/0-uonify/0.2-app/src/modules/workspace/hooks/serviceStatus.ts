import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { currentAccountEmail } from '@/modules/auth';
export interface ServiceStatus {
  accountEmail: string;
  googleCloudEmail: string | null;
  driveEmail: string | null;
  googleCloud: string;
  drive: string;
  projectReady: boolean;
  model: string;
  lastResponseAt: string | null;
  liveVoice?: 'not_integrated' | 'pilot_ready' | 'pilot_exhausted';
  access: { status: string; basis?: string; endsAt?: string };
}
export function useServiceStatus(enabled = true) {
  const account = currentAccountEmail();
  return useQuery({ queryKey: ['uony-services', account], queryFn: () => api.get<ServiceStatus>('/uony/services'), enabled: enabled && !USE_MOCKS && !!account, retry: false });
}
