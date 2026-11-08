import { selectThread } from '../../hooks/actions';
import { useWorkspaceStore } from '../../hooks/workspaceStore';
import { recentThreads } from '../../model/navigation';
import type { Thread } from '../../model/workspaceState';
import { DeleteWorkspaceItem } from './DeleteWorkspaceItem';

/**
 * Lista del panel «Hilos» (app-shell.js, `buildRecentList`): todos los hilos, del
 * más reciente al más antiguo.
 */
function ThreadButton({ thread, active }: { thread: Thread; active: boolean }) {
  return (
    <div className={`nav-item-row${active ? ' is-active' : ''}`}><button type="button" className={`thread-button${active ? ' is-active' : ''}`} data-action="thread" data-value={thread.id} aria-current={active ? 'true' : undefined} onClick={() => selectThread(thread.id)}>
      <span className="thread-icon" aria-hidden="true" />
      <span className="item-label">{thread.title}</span>
    </button><DeleteWorkspaceItem kind="thread" id={thread.id} name={thread.title} /></div>
  );
}

export function RecentThreads({ projectId = null }: { projectId?: string | null }) {
  const threads = useWorkspaceStore(state => state.threads);
  const activeThreadId = useWorkspaceStore(state => state.activeThreadId);
  const visible = threads.filter(thread => (thread.projectId ?? null) === projectId);
  if (!visible.length) return <p className="navigation-empty">Aún no hay hilos. Escribe un mensaje para empezar.</p>;
  return (
    <>
      {recentThreads({ threads: visible }).map(thread => <ThreadButton key={thread.id} thread={thread} active={thread.id === activeThreadId} />)}
    </>
  );
}
