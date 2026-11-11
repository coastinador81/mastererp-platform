import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectService } from './project-service.js';
import { createLocalAdapters } from '../adapters/local-adapters.js';

const context = (overrides = {}) => ({ tenantId: 'tenant-A', userId: 'user-admin', permissions: ['project:read', 'project:create', 'project:update', 'project:manage-members', 'project:close', 'phase:create', 'phase:update', 'milestone:create', 'milestone:update', 'task:create', 'task:update', 'task:archive', 'task:manage-dependencies'], requestId: 'req-1', correlationId: 'corr-1', ...overrides });
const setup = () => { const adapters = createLocalAdapters(); return { adapters, service: createProjectService(adapters) }; };

test('tenant context prevents cross-tenant reads', () => {
  const { service } = setup();
  const result = service.listProjects({}, context({ tenantId: 'tenant-B' }));
  assert.equal(result.ok, true); assert.equal(result.data.some((project) => project.id === 'a-1'), false);
});

test('denied command returns structured error and publishes event', () => {
  const { service, adapters } = setup();
  const result = service.createProject({ name: 'No autorizado', owner: 'Visor' }, context({ userId: 'user-viewer', permissions: [], requestId: 'req-denied' }));
  assert.equal(result.error.code, 'FORBIDDEN'); assert.equal(adapters.eventPublisher.list('tenant-A')[0].type, 'AccessDenied');
});

test('same request id is idempotent', () => {
  const { service } = setup();
  const first = service.createProject({ name: 'Único', owner: 'Ana' }, context({ requestId: 'req-once' }));
  const replay = service.createProject({ name: 'Único', owner: 'Ana' }, context({ requestId: 'req-once' }));
  assert.equal(first.ok, true); assert.equal(replay.replayed, true); assert.equal(service.listProjects({}, context({ requestId: 'read-1' })).data.filter((project) => project.name === 'Único').length, 1);
});

test('legacy task creation returns the complete work item model', () => {
  const { service } = setup();
  const task = service.createTask({ projectId: 'a-1', name: 'Tarea completa', assignee: 'Ana' }, context({ requestId: 'task-shape' })).data;
  assert.deepEqual({ status: task.status, priority: task.priority, dependencies: task.dependencies, parentTaskId: task.parentTaskId }, { status: 'Pendiente', priority: 'Media', dependencies: [], parentTaskId: null });
});

test('only allowed transitions publish status events', () => {
  const { service, adapters } = setup();
  const moving = service.changeProjectStatus({ projectId: 'a-2', status: 'En curso' }, context({ requestId: 'status-1' }));
  assert.equal(moving.ok, true); assert.equal(adapters.eventPublisher.list('tenant-A')[0].type, 'ProjectStatusChanged');
});

test('a participant from another tenant cannot be added', () => {
  const { service } = setup();
  const result = service.addParticipant({ projectId: 'a-1', userId: 'u-maria', projectRole: 'Colaborador' }, context({ requestId: 'member-1' }));
  assert.equal(result.error.code, 'CROSS_TENANT_PARTICIPANT');
});

test('a task cannot complete while its predecessor remains pending', () => {
  const { service } = setup();
  const task = service.createWorkItem({ projectId: 'a-1', name: 'Dependiente', assignee: 'Ana' }, context({ requestId: 'task-new' })).data;
  service.addTaskDependency({ projectId: 'a-1', taskId: task.id, predecessorId: 't-a-2' }, context({ requestId: 'dep-1' }));
  service.changeTaskStatus({ projectId: 'a-1', taskId: task.id, status: 'En curso' }, context({ requestId: 'progress-1' }));
  const result = service.changeTaskStatus({ projectId: 'a-1', taskId: task.id, status: 'Completada' }, context({ requestId: 'done-1' }));
  assert.equal(result.error.code, 'TASK_BLOCKED');
});

test('phases and milestones remain isolated by tenant', () => {
  const { service } = setup();
  const phase = service.createPhase({ projectId: 'a-1', name: 'Inicio' }, context({ requestId: 'phase-1' }));
  assert.equal(phase.ok, true);
  const otherTenant = service.createMilestone({ projectId: 'a-1', name: 'No visible', targetDate: '2026-12-01' }, context({ tenantId: 'tenant-B', requestId: 'milestone-1' }));
  assert.equal(otherTenant.error.code, 'NOT_FOUND');
});

test('a closed project rejects modifications', () => {
  const { service } = setup();
  const project = service.createProject({ name: 'Cerrable', owner: 'Ana' }, context({ requestId: 'closed-create' })).data;
  service.changeProjectStatus({ projectId: project.id, status: 'En curso' }, context({ requestId: 'closed-start' }));
  service.changeProjectStatus({ projectId: project.id, status: 'Cerrado' }, context({ requestId: 'closed-close' }));
  assert.equal(service.createPhase({ projectId: project.id, name: 'Bloqueada' }, context({ requestId: 'closed-phase' })).error.code, 'PROJECT_CLOSED');
  assert.equal(service.assignPortfolio({ projectId: project.id, portfolioId: 'portfolio-producto' }, context({ requestId: 'closed-portfolio' })).error.code, 'PROJECT_CLOSED');
});

test('a project with pending work cannot close', () => {
  const { service } = setup();
  assert.equal(service.changeProjectStatus({ projectId: 'a-2', status: 'En curso' }, context({ requestId: 'pending-start' })).ok, true);
  assert.equal(service.changeProjectStatus({ projectId: 'a-2', status: 'Cerrado' }, context({ requestId: 'pending-close' })).error.code, 'PROJECT_HAS_PENDING_WORK');
});

test('dependency cycles are rejected', () => {
  const { service } = setup();
  const task = service.createWorkItem({ projectId: 'a-1', name: 'Nueva', assignee: 'Ana' }, context({ requestId: 'cycle-new' })).data;
  service.addTaskDependency({ projectId: 'a-1', taskId: task.id, predecessorId: 't-a-1' }, context({ requestId: 'cycle-first' }));
  assert.equal(service.addTaskDependency({ projectId: 'a-1', taskId: 't-a-1', predecessorId: task.id }, context({ requestId: 'cycle-second' })).error.code, 'INVALID_DEPENDENCY');
});

test('invalid phase transitions are rejected', () => {
  const { service } = setup();
  const phase = service.createPhase({ projectId: 'a-1', name: 'Fase' }, context({ requestId: 'phase-new' })).data;
  assert.equal(service.changePhaseStatus({ projectId: 'a-1', phaseId: phase.id, status: 'Cerrada' }, context({ requestId: 'phase-invalid' })).error.code, 'INVALID_STATUS_TRANSITION');
});

test('a completed milestone cannot be completed twice', () => {
  const { service } = setup();
  const milestone = service.createMilestone({ projectId: 'a-1', name: 'Hito', targetDate: '2026-12-01' }, context({ requestId: 'milestone-new' })).data;
  assert.equal(service.completeMilestone({ projectId: 'a-1', milestoneId: milestone.id }, context({ requestId: 'milestone-complete' })).ok, true);
  assert.equal(service.completeMilestone({ projectId: 'a-1', milestoneId: milestone.id }, context({ requestId: 'milestone-repeat' })).error.code, 'MILESTONE_ALREADY_COMPLETED');
});

test('repeated phase request id does not duplicate the phase or event', () => {
  const { service, adapters } = setup();
  const first = service.createPhase({ projectId: 'a-1', name: 'Única' }, context({ requestId: 'phase-once' }));
  const replay = service.createPhase({ projectId: 'a-1', name: 'Única' }, context({ requestId: 'phase-once' }));
  assert.equal(first.ok, true); assert.equal(replay.replayed, true); assert.equal(service.listProjects({}, context({ requestId: 'phase-list' })).data.find((project) => project.id === 'a-1').phases.length, 1); assert.equal(adapters.eventPublisher.list('tenant-A').filter((entry) => entry.type === 'ProjectPhaseCreated').length, 1);
});

test('rejections publish structured audit events', () => {
  const { service, adapters } = setup();
  service.changeProjectStatus({ projectId: 'a-2', status: 'Cerrado' }, context({ requestId: 'audit-rejection' }));
  const event = adapters.eventPublisher.list('tenant-A')[0];
  assert.equal(event.type, 'OperationRejected'); assert.equal(event.payload.code, 'INVALID_STATUS_TRANSITION'); assert.equal(event.requestId, 'audit-rejection'); assert.ok(event.occurredAt);
});

test('WIP limit rejects a fourth active task and preserves its state', () => {
  const { service, adapters } = setup();
  const create = (name, requestId) => service.createWorkItem({ projectId: 'a-1', name, assignee: 'Ana' }, context({ requestId })).data;
  const second = create('WIP dos', 'wip-create-2'); const third = create('WIP tres', 'wip-create-3'); const fourth = create('WIP cuatro', 'wip-create-4');
  assert.equal(service.changeTaskStatus({ projectId: 'a-1', taskId: second.id, status: 'En curso' }, context({ requestId: 'wip-start-2' })).ok, true);
  assert.equal(service.changeTaskStatus({ projectId: 'a-1', taskId: third.id, status: 'En curso' }, context({ requestId: 'wip-start-3' })).ok, true);
  const rejected = service.changeTaskStatus({ projectId: 'a-1', taskId: fourth.id, status: 'En curso' }, context({ requestId: 'wip-start-4' }));
  assert.equal(rejected.error.code, 'WIP_LIMIT_EXCEEDED');
  assert.equal(service.listProjects({}, context({ requestId: 'wip-list' })).data.find((project) => project.id === 'a-1').tasks.find((task) => task.id === fourth.id).status, 'Pendiente');
  assert.equal(adapters.eventPublisher.list('tenant-A')[0].type, 'OperationRejected');
});

test('card details, checklist, duplication and archive are mock-functional', () => {
  const { service } = setup();
  const updated = service.updateCard({ projectId: 'a-1', taskId: 't-a-2', description: 'Preparar evidencia', startDate: '2026-11-01', dueDate: '2026-11-15', priority: 'Alta', assignee: 'Carlos Pérez' }, context({ requestId: 'card-update' })).data;
  assert.equal(updated.description, 'Preparar evidencia'); assert.equal(updated.dueDate, '2026-11-15'); assert.equal(updated.assignee, 'Carlos Pérez');
  const checklist = service.addChecklistItem({ projectId: 'a-1', taskId: 't-a-2', text: 'Revisar alcance' }, context({ requestId: 'check-add' })).data;
  assert.equal(service.toggleChecklistItem({ projectId: 'a-1', taskId: 't-a-2', checklistItemId: checklist.id, completed: true }, context({ requestId: 'check-toggle' })).data.completed, true);
  assert.equal(service.removeChecklistItem({ projectId: 'a-1', taskId: 't-a-2', checklistItemId: checklist.id }, context({ requestId: 'check-remove' })).ok, true);
  service.addChecklistItem({ projectId: 'a-1', taskId: 't-a-2', text: 'Elemento para duplicar' }, context({ requestId: 'check-copy' }));
  service.addAttachment({ projectId: 'a-1', taskId: 't-a-2', name: 'Brief', url: 'https://example.test/brief' }, context({ requestId: 'attachment-add' }));
  service.addComment({ projectId: 'a-1', taskId: 't-a-2', text: 'Listo para revisar' }, context({ requestId: 'comment-add' }));
  const copy = service.duplicateCard({ projectId: 'a-1', taskId: 't-a-2' }, context({ requestId: 'card-copy' })).data;
  assert.equal(copy.status, 'Pendiente'); assert.equal(copy.attachments.length, 0); assert.equal(copy.comments.length, 0); assert.equal(copy.checklist[0].completed, false);
  service.archiveCard({ projectId: 'a-1', taskId: copy.id }, context({ requestId: 'card-archive' }));
  const archived = service.listProjects({}, context({ requestId: 'card-list' })).data.find((project) => project.id === 'a-1').tasks.find((task) => task.id === copy.id);
  assert.ok(archived.archivedAt);
});

test('an empty checklist item is rejected with a structured error', () => {
  const { service } = setup();
  const result = service.addChecklistItem({ projectId: 'a-1', taskId: 't-a-2', text: '' }, context({ requestId: 'check-empty' }));
  assert.equal(result.error.code, 'CHECKLIST_ITEM_INVALID'); assert.equal(result.events[0].type, 'OperationRejected');
});

test('a card rejects an invalid start and due date range', () => {
  const { service } = setup();
  const result = service.updateCard({ projectId: 'a-1', taskId: 't-a-2', startDate: '2026-12-10', dueDate: '2026-12-01' }, context({ requestId: 'card-invalid-dates' }));
  assert.equal(result.error.code, 'TASK_DATE_INVALID');
});

test('board lists are customizable and cards move using the list as source of truth', () => {
  const { service } = setup();
  const created = service.createBoardList({ projectId: 'a-1', name: 'Revisión', color: 'verde', wipLimit: 1 }, context({ requestId: 'list-create' }));
  assert.equal(created.ok, true); assert.equal(created.data.name, 'Revisión');
  assert.equal(service.updateBoardList({ projectId: 'a-1', listId: created.data.id, name: 'Control', color: 'ámbar', wipLimit: 1 }, context({ requestId: 'list-update' })).data.name, 'Control');
  const moved = service.moveTaskToList({ projectId: 'a-1', taskId: 't-a-2', listId: created.data.id }, context({ requestId: 'list-move' }));
  assert.equal(moved.ok, true); assert.equal(moved.data.listId, created.data.id);
  assert.equal(service.moveTaskToList({ projectId: 'a-1', taskId: 't-a-1', listId: created.data.id }, context({ requestId: 'list-wip' })).error.code, 'WIP_LIMIT_EXCEEDED');
  assert.equal(service.archiveBoardList({ projectId: 'a-1', listId: created.data.id }, context({ requestId: 'list-archive-denied' })).error.code, 'LIST_NOT_EMPTY');
});

test('a card cannot move to a final list while its dependency remains active', () => {
  const { service } = setup();
  service.addTaskDependency({ projectId: 'a-1', taskId: 't-a-2', predecessorId: 't-a-1' }, context({ requestId: 'list-dependency' }));
  const project = service.listProjects({}, context({ requestId: 'list-read' })).data.find((item) => item.id === 'a-1');
  const done = project.boardLists.find((list) => list.isDone);
  assert.equal(service.moveTaskToList({ projectId: 'a-1', taskId: 't-a-2', listId: done.id }, context({ requestId: 'list-finish-blocked' })).error.code, 'TASK_BLOCKED');
});

test('an empty custom list can be permanently deleted and active positions are compacted', () => {
  const { service, adapters } = setup();
  const created = service.createBoardList({ projectId: 'a-1', name: 'Creada por error' }, context({ requestId: 'list-delete-create' })).data;
  const deleted = service.deleteBoardList({ projectId: 'a-1', listId: created.id }, context({ requestId: 'list-delete' }));
  assert.equal(deleted.ok, true); assert.equal(adapters.eventPublisher.list('tenant-A')[0].type, 'BoardListDeleted');
  const lists = service.listProjects({}, context({ requestId: 'list-delete-read' })).data.find((project) => project.id === 'a-1').boardLists.filter((list) => !list.archivedAt).sort((a, b) => a.position - b.position);
  assert.equal(lists.some((list) => list.id === created.id), false); assert.deepEqual(lists.map((list) => list.position), [1, 2, 3, 4]);
});

test('default lists and the only active list cannot be deleted', () => {
  const { service } = setup();
  assert.equal(service.deleteBoardList({ projectId: 'a-1', listId: 'a-1-list-pending' }, context({ requestId: 'list-delete-default' })).error.code, 'LIST_DELETE_FORBIDDEN');
  const adapters = createLocalAdapters({ 'tenant-A': [{ id: 'single', tenantId: 'tenant-A', name: 'Único', owner: 'Ana', status: 'En curso', participants: [], phases: [], milestones: [], tasks: [], boardLists: [{ id: 'custom-single', name: 'Única', color: 'azul', position: 1, wipLimit: null, isDone: false, archivedAt: null }] }] });
  const singleService = createProjectService(adapters);
  assert.equal(singleService.deleteBoardList({ projectId: 'single', listId: 'custom-single' }, context({ requestId: 'list-delete-last' })).error.code, 'LIST_DELETE_FORBIDDEN');
});

test('time and manual costs calculate the project total and enforce daily hours', () => {
  const { service } = setup();
  const time = service.addTimeEntry({ projectId: 'a-1', taskId: 't-a-2', date: '2026-11-04', hours: 2.5, assignee: 'Ana Díaz', description: 'Prueba' }, context({ requestId: 'time-add' }));
  assert.equal(time.data.cost, 50);
  assert.equal(service.addCostEntry({ projectId: 'a-1', taskId: 't-a-2', date: '2026-11-04', concept: 'Material', type: 'Material', amount: 12 }, context({ requestId: 'cost-add' })).ok, true);
  const summary = service.getProjectCostSummary({ projectId: 'a-1' }, context({ requestId: 'cost-summary' })).data;
  assert.equal(summary.total, 62); assert.equal(summary.hours, 2.5);
  assert.equal(service.addTimeEntry({ projectId: 'a-1', taskId: 't-a-2', date: '2026-11-04', hours: 22, assignee: 'Ana Díaz' }, context({ requestId: 'time-limit' })).error.code, 'TIME_DAILY_LIMIT');
});

test('time and cost entries reject invalid values and completed cards', () => {
  const { service } = setup();
  assert.equal(service.addTimeEntry({ projectId: 'a-1', taskId: 't-a-2', date: '2026-11-04', hours: 1.1 }, context({ requestId: 'time-invalid' })).error.code, 'TIME_ENTRY_INVALID');
  assert.equal(service.addCostEntry({ projectId: 'a-1', taskId: 't-a-2', date: '2026-11-04', concept: '', amount: 4 }, context({ requestId: 'cost-invalid' })).error.code, 'COST_ENTRY_INVALID');
  service.changeTaskStatus({ projectId: 'a-1', taskId: 't-a-2', status: 'En curso' }, context({ requestId: 'time-progress' })); service.changeTaskStatus({ projectId: 'a-1', taskId: 't-a-2', status: 'Completada' }, context({ requestId: 'time-complete' }));
  assert.equal(service.addTimeEntry({ projectId: 'a-1', taskId: 't-a-2', date: '2026-11-04', hours: 1 }, context({ requestId: 'time-closed' })).error.code, 'TASK_READ_ONLY');
});
