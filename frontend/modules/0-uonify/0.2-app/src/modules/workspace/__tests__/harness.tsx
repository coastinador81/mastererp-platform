import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { queryClient } from '@/shared/api/queryClient';
import { useComposerStore } from '../hooks/composerStore';
import { useUiStore, workspaceRefs } from '../hooks/uiStore';
import { resetLimitWatcher } from '../hooks/useLimitWatcher';
import { resetWorkspaceStore } from '../hooks/workspaceStore';
import { parseWorkspacePath } from '../model/services';
import { routes } from '../routes';

/**
 * Utilidades de las pruebas del espacio. Los archivos que pintan el espacio
 * sustituyen antes el puente con auth y la API de Uony con vi.mock.
 */
export function resetStores(path = '/espacio'): void {
  sessionStorage.clear();
  queryClient.clear();
  resetWorkspaceStore();
  useUiStore.setState({
    route: parseWorkspacePath(path),
    navOpen: false,
    servicesOpen: false,
    accountOpen: false,
    limitDialog: null,
    chatSheetOpen: false,
    pendingReply: null,
    liveText: '',
    embeddedDocks: 0,
    topbarCenterCount: 0,
    sheetTitle: null,
    chatDragWidth: null,
  });
  useComposerStore.setState({ draft: '', productLink: null, attachments: [], status: '', picker: null, usageOpen: false, moreOpen: false, listening: null, model: 'auto', effort: 'medium', speed: 'standard', dismissedSuggestions: [] });
  workspaceRefs.navReturnFocus = null;
  resetLimitWatcher();
}

/** Navegación simulada para el motor sin router: actualiza el servicio actual. */
export function fakeNavigate(): (to: string) => void {
  return (to: string) => useUiStore.setState({ route: parseWorkspacePath(to) });
}

export function renderWorkspace(path = '/espacio') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}
