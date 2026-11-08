import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { parseWorkspacePath, type WorkspaceRoute } from '../model/services';

/** Servicio y vista actuales (en el PROTO, `activeService` y `serviceView`). */
export function useWorkspaceRoute(): WorkspaceRoute {
  const { pathname } = useLocation();
  return useMemo(() => parseWorkspacePath(pathname), [pathname]);
}
