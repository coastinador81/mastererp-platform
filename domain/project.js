const transitions = { 'Planificación': ['En curso'], 'En curso': ['Cerrado'], Cerrado: [] };
const workTransitions = { Pendiente: ['En curso', 'Bloqueada'], 'En curso': ['Completada', 'Bloqueada'], Bloqueada: ['Pendiente', 'En curso'], Completada: [] };
const phaseTransitions = { Pendiente: ['En curso'], 'En curso': ['Cerrada'], Cerrada: [] };

export function newProject({ id, tenantId, name, owner, portfolioId = 'portfolio-general' }) {
  if (!name?.trim() || !owner?.trim()) throw new Error('PROJECT_DATA_INVALID');
  return { id, tenantId, name: name.trim(), owner: owner.trim(), portfolioId, status: 'Planificación', participants: [], phases: [], milestones: [], boardLists: initialBoardLists(id), tasks: [] };
}

export function initialBoardLists(projectId) { return [
  { id: `${projectId}-list-pending`, name: 'Pendiente', color: 'azul', position: 1, wipLimit: null, isDone: false, archivedAt: null },
  { id: `${projectId}-list-progress`, name: 'En curso', color: 'verde', position: 2, wipLimit: 3, isDone: false, archivedAt: null },
  { id: `${projectId}-list-blocked`, name: 'Bloqueada', color: 'ámbar', position: 3, wipLimit: null, isDone: false, archivedAt: null },
  { id: `${projectId}-list-done`, name: 'Completada', color: 'gris', position: 4, wipLimit: null, isDone: true, archivedAt: null }
]; }

export function newTask({ id, name, assignee }) {
  if (!name?.trim() || !assignee?.trim()) throw new Error('TASK_DATA_INVALID');
  return { id, name: name.trim(), assignee: assignee.trim() };
}

export function canTransitionStatus(from, to) { return transitions[from]?.includes(to) ?? false; }
export function canTransitionWorkStatus(from, to) { return workTransitions[from]?.includes(to) ?? false; }
export function canTransitionPhaseStatus(from, to) { return phaseTransitions[from]?.includes(to) ?? false; }
export function newPhase({ id, tenantId, projectId, name, order }) { if (!name?.trim()) throw new Error('PHASE_DATA_INVALID'); return { id, tenantId, projectId, name: name.trim(), order, status: 'Pendiente' }; }
export function newMilestone({ id, tenantId, projectId, phaseId, name, targetDate }) { if (!name?.trim() || !targetDate) throw new Error('MILESTONE_DATA_INVALID'); return { id, tenantId, projectId, phaseId: phaseId || null, name: name.trim(), targetDate, status: 'Pendiente' }; }
export function newWorkItem({ id, tenantId, projectId, phaseId, parentTaskId, name, assignee, priority = 'Media', dueDate, startDate, description = '', checklist = [], listId = null }) { if (!name?.trim() || !assignee?.trim()) throw new Error('TASK_DATA_INVALID'); return { id, tenantId, projectId, phaseId: phaseId || null, parentTaskId: parentTaskId || null, name: name.trim(), assignee: assignee.trim(), priority, description: description.trim(), startDate: startDate || null, dueDate: dueDate || null, checklist, attachments: [], comments: [], archivedAt: null, listId, status: 'Pendiente', dependencies: [] }; }
