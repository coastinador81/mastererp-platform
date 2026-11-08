import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { api, errorMessage } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { Folder, FolderPlus } from 'lucide-react';
import { startNewThread } from '../../hooks/actions';
import { useProjects, type WorkspaceProject } from '../../hooks/projects';
import { useWorkspaceStore } from '../../hooks/workspaceStore';
import { RecentThreads } from './NavLists';
import { DeleteWorkspaceItem } from './DeleteWorkspaceItem';
import '../../styles/projects.css';

export function Projects() {
  const projects = useProjects();
  const client = useQueryClient();
  const active = useWorkspaceStore(state => state.activeProjectId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const visibleProject = expanded ?? active;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const requestId = useRef('');
  const focusName = useCallback((element: HTMLInputElement | null) => element?.focus(), []);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = () => { setCreating(false); setError(''); trigger.current?.focus(); };
  const create = async () => {
    if (!name.trim() || saving) return;
    const account = currentAccountEmail();
    setSaving(true); setError('');
    try {
      const project = await api.post<WorkspaceProject>('/uony/projects', { id: requestId.current, name: name.trim() });
      if (account !== currentAccountEmail()) return;
      client.setQueryData<{ projects: WorkspaceProject[] }>(['uony-projects', account], old => ({ projects: [...(old?.projects ?? []).filter(item => item.id !== project.id), project] }));
      setCreating(false); setName(''); setExpanded(project.id);
      startNewThread(project.id);
    } catch (cause) { if (account === currentAccountEmail()) setError(errorMessage(cause)); }
    finally { setSaving(false); }
  };
  return <section className="nav-drawer-section nav-projects" aria-labelledby="nav-projects-title">
    <button ref={trigger} type="button" className="nav-drawer-new" disabled={saving} aria-expanded={creating} onClick={() => { requestId.current = crypto.randomUUID(); setName(''); setError(''); setCreating(true); }}>
      <FolderPlus size={16} aria-hidden="true" /> Nuevo proyecto
    </button>
    {creating && <form className="nav-project-form" onSubmit={event => { event.preventDefault(); void create(); }} onKeyDown={event => { if (event.key === 'Escape' && !saving) { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
      <label htmlFor="project-name">Nombre del proyecto</label>
      <input ref={focusName} id="project-name" value={name} maxLength={80} placeholder="Por ejemplo, colección de otoño" disabled={saving} onChange={event => { setName(event.target.value); requestId.current = crypto.randomUUID(); }} />
      <p>Organiza las conversaciones de un mismo trabajo.</p>
      {error && <p role="alert">{error}</p>}
      <div className="nav-project-actions">
        <button type="button" disabled={saving} onClick={cancel}>Cancelar</button>
        <button type="submit" disabled={!name.trim() || saving || USE_MOCKS}>{saving ? 'Guardando…' : 'Crear proyecto'}</button>
      </div>
    </form>}
    <div className="nav-drawer-section-head"><h2 id="nav-projects-title">Proyectos</h2></div>
    {projects.isLoading && <p className="navigation-empty" role="status">Cargando proyectos…</p>}
    {projects.isError && <p className="navigation-empty" role="alert">No se han podido cargar. <button type="button" onClick={() => void projects.refetch()}>Reintentar</button></p>}
    {!projects.isLoading && !projects.isError && !projects.data?.projects.length && <p className="navigation-empty">Tus proyectos aparecerán aquí.</p>}
    {projects.data?.projects.map(project => <div key={project.id} className="nav-project">
      <div className={`nav-item-row${visibleProject === project.id ? ' is-active' : ''}`}><button type="button" className="nav-project-name" aria-expanded={visibleProject === project.id} onClick={() => setExpanded(visibleProject === project.id ? '' : project.id)}>
        <Folder size={16} aria-hidden="true" /><span>{project.name}</span>
      </button><DeleteWorkspaceItem kind="project" id={project.id} name={project.name} /></div>
      {visibleProject === project.id && <div className="nav-project-threads">
        <button type="button" className="nav-project-new-thread" onClick={() => startNewThread(project.id)}>+ Nuevo hilo en este proyecto</button>
        <RecentThreads projectId={project.id} />
      </div>}
    </div>)}
  </section>;
}

export function ProjectContext() {
  const activeId = useWorkspaceStore(state => state.activeThreadId);
  const threads = useWorkspaceStore(state => state.threads);
  const selected = useWorkspaceStore(state => state.activeProjectId);
  const projects = useProjects();
  const id = threads.find(thread => thread.id === activeId)?.projectId ?? (activeId ? null : selected);
  const project = projects.data?.projects.find(item => item.id === id);
  if (!project) return null;
  return <div className="composer-project-context"><Folder size={14} aria-hidden="true" /><span>Proyecto · {project.name}</span></div>;
}
