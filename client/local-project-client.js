import { createProjectService } from '../application/project-service.js';
import { createLocalAdapters } from '../adapters/local-adapters.js';
import { canAccessProject, migrateIdentityReferences } from '../domain/access-policy.js';

let serial = 0;
const requestId = () => `local-${Date.now()}-${++serial}`;
export function createLocalProjectClient() {
  const adapters = createLocalAdapters(); const service = createProjectService(adapters); const allPermissions = ['project:read', 'project:create', 'task:create', 'task:update', 'task:archive', 'task:manage-dependencies', 'phase:create', 'phase:update', 'milestone:create', 'milestone:update', 'project:update', 'project:manage-members', 'project:close']; const rolePermissions = { Administrador: allPermissions, Responsable: allPermissions.filter((permission) => permission !== 'project:create'), Colaborador: ['project:read', 'task:create', 'task:update', 'task:archive', 'task:manage-dependencies'], Observador: ['project:read'] }; let session = { userId: 'user-admin', tenantId: 'tenant-A' };
  const currentUser = () => adapters.userDirectory.findById(session.tenantId, session.userId) ?? adapters.userDirectory.listAll().find((user) => user.userId === session.userId);
  const context = (permissions = null) => { const user = currentUser(); const effective = permissions ?? rolePermissions[user?.role] ?? []; return { tenantId: session.tenantId, userId: session.userId, permissions: effective, requestId: requestId(), correlationId: `corr-${requestId()}` }; };
  return {
    setTenant: (value) => { const user = currentUser(); if (user?.allowedTenantIds.includes(value)) session.tenantId = value; }, getTenant: () => session.tenantId,
    getSession: () => ({ user: currentUser(), tenantId: session.tenantId }), login: (userId) => { const user = adapters.userDirectory.listAll().find((item) => item.userId === userId && item.active); if (!user) return { ok: false }; session = { userId: user.userId, tenantId: user.defaultTenantId }; return { ok: true, user }; }, logout: () => { session = { userId: null, tenantId: 'tenant-A' }; }, listSessionUsers: () => adapters.userDirectory.listAll().filter((user) => user.active),
    listManagedUsers: () => currentUser()?.role === 'Administrador' ? adapters.userDirectory.listAll().filter((user) => user.allowedTenantIds.includes(session.tenantId)) : [], updateMockUser: (user) => { if (currentUser()?.role !== 'Administrador') return { ok: false, error: { code: 'FORBIDDEN', message: 'Solo Administrador' } }; const existing = adapters.userDirectory.listAll().find((item) => item.userId === user.userId); const next = { ...existing, ...user }; const admins = adapters.userDirectory.listAll().filter((item) => item.active && item.role === 'Administrador' && item.allowedTenantIds.includes(session.tenantId)); if (existing?.role === 'Administrador' && existing.active && (!next.active || !next.allowedTenantIds.includes(session.tenantId)) && admins.length <= 1) return { ok: false, error: { code: 'LAST_ADMIN', message: 'Debe quedar un Administrador activo' } }; adapters.userDirectory.save(next); return { ok: true, data: next }; },
    listProjects: () => { const user = currentUser(); const users = adapters.userDirectory.listAll(); return service.listProjects({}, context()).data.map((project) => migrateIdentityReferences(project, users)).filter((project) => canAccessProject(user, project)); },
    getAudit: () => adapters.eventPublisher.list(session.tenantId),
    createProject: (command) => service.createProject(command, context()),
    createTask: (command) => service.createTask(command, context()),
    assignPortfolio: (command) => service.assignPortfolio(command, context()),
    changeProjectStatus: (command) => service.changeProjectStatus(command, context()),
    addParticipant: (command) => service.addParticipant(command, context()),
    createPhase: (command) => service.createPhase(command, context()),
    createMilestone: (command) => service.createMilestone(command, context()),
    changePhaseStatus: (command) => service.changePhaseStatus(command, context()),
    completeMilestone: (command) => service.completeMilestone(command, context()),
    createWorkItem: (command) => service.createWorkItem(command, context()),
    changeTaskStatus: (command) => service.changeTaskStatus(command, context()),
    addTaskDependency: (command) => service.addTaskDependency(command, context()),
    updateWorkItem: (command) => service.updateWorkItem(command, context()),
    updateCard: (command) => service.updateCard(command, context()),
    addChecklistItem: (command) => service.addChecklistItem(command, context()),
    toggleChecklistItem: (command) => service.toggleChecklistItem(command, context()),
    removeChecklistItem: (command) => service.removeChecklistItem(command, context()),
    addAttachment: (command) => service.addAttachment(command, context()),
    addComment: (command) => service.addComment(command, context()),
    duplicateCard: (command) => service.duplicateCard(command, context()),
    archiveCard: (command) => service.archiveCard(command, context()),
    createBoardList: (command) => service.createBoardList(command, context()),
    updateBoardList: (command) => service.updateBoardList(command, context()),
    moveBoardList: (command) => service.moveBoardList(command, context()),
    archiveBoardList: (command) => service.archiveBoardList(command, context()),
    deleteBoardList: (command) => service.deleteBoardList(command, context()),
    moveTaskToList: (command) => service.moveTaskToList(command, context()),
    addTimeEntry: (command) => service.addTimeEntry(command, context()),
    removeTimeEntry: (command) => service.removeTimeEntry(command, context()),
    addCostEntry: (command) => service.addCostEntry(command, context()),
    removeCostEntry: (command) => service.removeCostEntry(command, context()),
    updateTaskEstimate: (command) => service.updateTaskEstimate(command, context()),
    getProjectCostSummary: (command) => service.getProjectCostSummary(command, context()),
    getKanbanPolicy: () => service.getKanbanPolicy(),
    listPortfolios: () => adapters.portfolioRepository.listByTenant(session.tenantId),
    listUsers: () => adapters.userDirectory.listByTenant(session.tenantId),
    simulateDenied: (command) => service.createProject(command, context([]))
  };
}
