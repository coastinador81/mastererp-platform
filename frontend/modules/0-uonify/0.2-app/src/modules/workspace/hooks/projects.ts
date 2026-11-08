import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { currentAccountEmail } from '@/modules/auth';

export interface WorkspaceProject { id: string; name: string }
export function useProjects() {
  const account = currentAccountEmail();
  return useQuery({ queryKey: ['uony-projects', account], queryFn: () => api.get<{ projects: WorkspaceProject[] }>('/uony/projects'), enabled: !USE_MOCKS && !!account, retry: false });
}
