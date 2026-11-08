import type { Thread, WorkspaceData } from './workspaceState';

/**
 * Lista del panel «Hilos» (app-shell.js, `buildRecentList`). Decisión del dueño
 * (27-09-2026): solo hay hilos; los grupos de proyecto del PROTO se quitan.
 */

/** Recientes: todos los hilos, del más reciente al más antiguo. */
export function recentThreads(data: Pick<WorkspaceData, 'threads'>): Thread[] {
  return data.threads.slice().reverse();
}
