import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { currentAccountEmail } from '@/modules/auth';
import { api, errorMessage } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { Button, Dialog } from '@/shared/ui';
import { useWorkspaceStore } from '../../hooks/workspaceStore';
import { useComposerStore } from '../../hooks/composerStore';
import { useUiStore } from '../../hooks/uiStore';
import type { WorkspaceProject } from '../../hooks/projects';
import type { Thread } from '../../model/workspaceState';
import { clearExpectedAssignmentFocus } from '../../api/assignmentFocusExpectation';
import '../../styles/projects.css';

interface Props { kind: 'project' | 'thread'; id: string; name: string }
export function DeleteWorkspaceItem(props: Props) {
  return USE_MOCKS ? null : <DeleteAction {...props} />;
}

function DeleteAction({ kind, id, name }: Props) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const threads = useWorkspaceStore(state => state.threads);
  const pending = useUiStore(state => state.pendingReply?.threadId);
  const busy = !!pending && (kind === 'thread' ? pending === id : threads.some(thread => thread.id === pending && thread.projectId === id));
  const label = kind === 'project' ? 'proyecto' : 'hilo';
  const remove = async () => {
    if (saving || busy) return;
    const account = currentAccountEmail();
    const epoch = useWorkspaceStore.getState().historyEpoch;
    const current = () => account === currentAccountEmail() && epoch === useWorkspaceStore.getState().historyEpoch;
    setSaving(true); setError('');
    try {
      const result = await api.delete<{ threadIds: string[] }>(`/uony/${kind === 'project' ? 'projects' : 'threads'}/${encodeURIComponent(id)}`);
      if (!current()) return;
      await cache.cancelQueries({ queryKey: ['uony-threads', account] });
      await cache.cancelQueries({ queryKey: ['uony-projects', account] });
      if (!current()) return;
      const removed = new Set(result.threadIds);
      const store = useWorkspaceStore.getState();
      const activeRemoved = !!store.activeThreadId && removed.has(store.activeThreadId);
      const projectRemoved = kind === 'project' && store.activeProjectId === id;
      useWorkspaceStore.setState({
        threads: store.threads.filter(thread => !removed.has(thread.id)),
        ...(activeRemoved ? { activeThreadId: null, conversationExpanded: false } : {}),
        ...(projectRemoved ? { activeProjectId: null } : {}),
      });
      removed.forEach(threadId => {
        useComposerStore.getState().clearThreadStatus(threadId);
        if (account) clearExpectedAssignmentFocus(account, threadId);
      });
      if (activeRemoved || (projectRemoved && !store.activeThreadId)) useComposerStore.setState({ draft: '', status: '' });
      cache.setQueriesData<{ threads: Thread[] }>({ queryKey: ['uony-threads', account] }, old => old && ({ ...old, threads: old.threads.filter(thread => !removed.has(thread.id)) }));
      if (kind === 'project') cache.setQueryData<{ projects: WorkspaceProject[] }>(['uony-projects', account], old => old && ({ projects: old.projects.filter(project => project.id !== id) }));
      setOpen(false);
      requestAnimationFrame(() => { if (current()) document.querySelector<HTMLElement>('#nav-drawer .nav-drawer-new')?.focus(); });
    } catch (cause) { if (current()) setError(errorMessage(cause)); }
    finally { setSaving(false); }
  };
  return <>
    <button type="button" className="nav-item-delete" aria-label={`Eliminar ${label}: ${name}`} title={busy ? 'Espera a que Uony termine de responder' : `Eliminar ${label}`} disabled={busy || saving} onClick={() => { setError(''); setOpen(true); }}><Trash2 size={15} aria-hidden="true" /></button>
    <Dialog open={open} title={`Eliminar ${label}`} size="sm" dismissible={!saving} onClose={() => { if (!saving) setOpen(false); }}
      footer={<><Button disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button><Button variant="danger" disabled={saving || busy} onClick={() => void remove()}>{saving ? 'Eliminando…' : `Eliminar ${label}`}</Button></>}>
      <p className="nav-delete-name">«{name}»</p>
      <p>{kind === 'project' ? 'Se eliminarán este proyecto y todas sus conversaciones de Uonify.' : 'Se eliminarán este hilo y todos sus mensajes.'} Esta acción no se puede deshacer.</p>
      {kind === 'project' && <p>Tus conexiones y archivos de Google Drive se conservan.</p>}
      {error && <p role="alert" className="nav-delete-error">{error}</p>}
    </Dialog>
  </>;
}
