import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { DeleteWorkspaceItem } from '../components/navigation/DeleteWorkspaceItem';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { setUi } from '../hooks/uiStore';
import { useLiveHistory } from '../hooks/liveConversation';
import { historyKey } from '../hooks/liveHistory';
import { expectedAssignmentFocus, rememberExpectedAssignmentFocus } from '../api/assignmentFocusExpectation';
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'one@example.test', useSession: () => ({ status: 'ready', user: { email: 'one@example.test' } }) }));
const thread = { id: 't1', title: 'Ficha otoño', projectId: 'p1', service: null, view: 'default', messages: [] };
beforeEach(() => { sessionStorage.clear(); resetWorkspaceStore(); setUi({ pendingReply: null }); useComposerStore.setState({ draft: '' }); });
afterEach(() => vi.restoreAllMocks());
function mount(kind: 'thread' | 'project' = 'thread') {
  const cache = new QueryClient();
  cache.setQueryData(['uony-threads', 'one@example.test'], { threads: [thread] });
  cache.setQueryData(historyKey('one@example.test', useWorkspaceStore.getState().historyEpoch), { threads: [thread] });
  cache.setQueryData(['uony-projects', 'one@example.test'], { projects: [{ id: 'p1', name: 'Otoño' }] });
  useWorkspaceStore.setState({ threads: [thread], activeThreadId: 't1', activeProjectId: 'p1' });
  render(<QueryClientProvider client={cache}><DeleteWorkspaceItem kind={kind} id={kind === 'thread' ? 't1' : 'p1'} name="Otoño" /></QueryClientProvider>);
  return cache;
}

it('exige confirmar, permite cancelar y solo retira el hilo tras éxito del servidor', async () => {
  const remove = vi.spyOn(api, 'delete').mockResolvedValue({ threadIds: ['t1'] });
  const cache = mount();
  expect(rememberExpectedAssignmentFocus('one@example.test', 't1', '11111111-1111-4111-8111-111111111111', 1)).toBe(true);
  useComposerStore.getState().setThreadStatus('t1', 'Error anterior de este hilo.');
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar hilo: Otoño' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(useWorkspaceStore.getState().threads).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar hilo: Otoño' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar hilo' }));
  await waitFor(() => expect(useWorkspaceStore.getState().threads).toHaveLength(0));
  expect(remove).toHaveBeenCalledWith('/uony/threads/t1');
  expect(useWorkspaceStore.getState().activeThreadId).toBeNull();
  expect(useComposerStore.getState().threadStatuses.t1).toBeUndefined();
  expect(expectedAssignmentFocus('one@example.test', 't1')).toEqual({ kind: 'none' });
  expect(cache.getQueryData(['uony-threads', 'one@example.test'])).toEqual({ threads: [] });
  expect(cache.getQueryData(historyKey('one@example.test', useWorkspaceStore.getState().historyEpoch))).toEqual({ threads: [] });
  expect(cache.getQueryData(['uony-projects', 'one@example.test'])).toEqual({ projects: [{ id: 'p1', name: 'Otoño' }] });
});

it('explica la cascada del proyecto y limpia su selección y borrador', async () => {
  vi.spyOn(api, 'delete').mockResolvedValue({ threadIds: ['t1'] });
  const cache = mount('project');
  expect(rememberExpectedAssignmentFocus('one@example.test', 't1', '11111111-1111-4111-8111-111111111111', 1)).toBe(true);
  useComposerStore.setState({ draft: 'Borrador del proyecto' });
  useComposerStore.getState().setThreadStatus('t1', 'Error anterior de este proyecto.');
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar proyecto: Otoño' }));
  expect(screen.getByText(/este proyecto y todas sus conversaciones/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar proyecto' }));
  await waitFor(() => expect(cache.getQueryData(['uony-projects', 'one@example.test'])).toEqual({ projects: [] }));
  expect(useWorkspaceStore.getState().activeProjectId).toBeNull();
  expect(useComposerStore.getState().draft).toBe('');
  expect(useComposerStore.getState().threadStatuses.t1).toBeUndefined();
  expect(expectedAssignmentFocus('one@example.test', 't1')).toEqual({ kind: 'none' });
});

it('un fallo no borra datos y una respuesta pendiente bloquea la acción', async () => {
  vi.spyOn(api, 'delete').mockRejectedValue(new Error('Espera a que Uony termine'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar hilo: Otoño' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar hilo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Espera a que Uony termine');
  expect(useWorkspaceStore.getState().threads).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  setUi({ pendingReply: { threadId: 't1', label: 'Preparando' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Eliminar hilo: Otoño' })).toBeDisabled());
});

it('actualizar el historial tras eliminar otro hilo conserva la conversación abierta', async () => {
  const other = { ...thread, id: 't2' };
  const cache = new QueryClient();
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [thread, other] });
  function History() { useLiveHistory(); return null; }
  render(<QueryClientProvider client={cache}><History /></QueryClientProvider>);
  await waitFor(() => expect(useWorkspaceStore.getState().activeThreadId).toBe('t2'));
  useWorkspaceStore.setState({ activeThreadId: 't1' });
  cache.setQueryData(historyKey('one@example.test', useWorkspaceStore.getState().historyEpoch), {
    threads: [thread], account: 'one@example.test', epoch: useWorkspaceStore.getState().historyEpoch,
    revision: useWorkspaceStore.getState().historyRevision,
  });
  await waitFor(() => expect(useWorkspaceStore.getState().threads).toHaveLength(1));
  expect(useWorkspaceStore.getState().activeThreadId).toBe('t1');
});
