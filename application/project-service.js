import { newProject, newTask, canTransitionStatus, newPhase, newMilestone, newWorkItem, canTransitionPhaseStatus, canTransitionWorkStatus, initialBoardLists } from '../domain/project.js';
import { initializeCostData, projectCostSummary, rateFor, taskCostSummary, validHours } from '../domain/time-cost.js';

const requiredContext = ['tenantId', 'userId', 'permissions', 'requestId', 'correlationId'];
const WIP_LIMIT = 3;
const clone = (value) => structuredClone(value);

export function createProjectService({ repository, portfolioRepository, userDirectory, authorizer, eventPublisher, idempotencyStore }) {
  function validateContext(context) {
    const missing = requiredContext.filter((key) => context[key] === undefined || context[key] === null || context[key] === '');
    if (missing.length) throw new Error(`REQUEST_CONTEXT_INVALID:${missing.join(',')}`);
  }
  function event(type, context, payload = {}) {
    return { type, tenantId: context.tenantId, userId: context.userId, requestId: context.requestId, correlationId: context.correlationId, occurredAt: new Date().toISOString(), payload };
  }
  function denied(permission, context) {
    const domainEvent = event('AccessDenied', context, { permission });
    eventPublisher.publish(domainEvent);
    return { ok: false, error: { code: 'FORBIDDEN', message: 'No tiene permiso para esta operación', correlationId: context.correlationId }, events: [domainEvent] };
  }
  function executeIdempotent(context, operation) {
    const cached = idempotencyStore.get(context.tenantId, context.requestId);
    if (cached) return { ...clone(cached), replayed: true };
    const result = operation();
    idempotencyStore.put(context.tenantId, context.requestId, result);
    return result;
  }
  return {
    listProjects(query, context) {
      validateContext(context);
      if (!authorizer.allows(context, 'project:read')) return denied('project:read', context);
      const projects = repository.listByTenant(context.tenantId, query); projects.forEach(ensureBoard); return { ok: true, data: projects, events: [] };
    },
    createProject(command, context) {
      validateContext(context);
      if (!authorizer.allows(context, 'project:create')) return denied('project:create', context);
      return executeIdempotent(context, () => {
        const project = newProject({ id: `project-${context.requestId}`, tenantId: context.tenantId, name: command.name, owner: command.owner });
        repository.save(project);
        const domainEvent = event('ProjectCreated', context, { projectId: project.id, name: project.name });
        eventPublisher.publish(domainEvent);
        return { ok: true, data: clone(project), events: [domainEvent] };
      });
    },
    createTask(command, context) {
      validateContext(context);
      if (!authorizer.allows(context, 'task:create')) return denied('task:create', context);
      return executeIdempotent(context, () => {
        const project = repository.findById(context.tenantId, command.projectId);
        if (!project) {
          const domainEvent = event('AccessDenied', context, { reason: 'PROJECT_NOT_IN_TENANT', projectId: command.projectId });
          eventPublisher.publish(domainEvent);
          return { ok: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado en el tenant activo', correlationId: context.correlationId }, events: [domainEvent] };
        }
        if (project.status === 'Cerrado') return closed(context);
        ensureBoard(project); const task = newWorkItem({ id: `task-${context.requestId}`, tenantId: context.tenantId, projectId: project.id, listId: defaultListId(project), ...command });
        project.tasks.push(task); repository.save(project);
        const domainEvent = event('TaskCreated', context, { projectId: project.id, taskId: task.id, name: task.name });
        eventPublisher.publish(domainEvent);
        return { ok: true, data: clone(task), events: [domainEvent] };
      });
    }
    ,assignPortfolio(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'project:update')) return denied('project:update', context);
      return executeIdempotent(context, () => {
        const project = repository.findById(context.tenantId, command.projectId); const portfolio = portfolioRepository.findById(context.tenantId, command.portfolioId);
        if (!project || !portfolio) return { ok: false, error: { code: 'NOT_FOUND', message: 'Proyecto o portafolio no encontrado', correlationId: context.correlationId }, events: [] };
        if (project.status === 'Cerrado') return closed(context);
        const previousPortfolioId = project.portfolioId; project.portfolioId = portfolio.id; repository.save(project);
        const domainEvent = event('PortfolioAssigned', context, { projectId: project.id, previousPortfolioId, portfolioId: portfolio.id }); eventPublisher.publish(domainEvent);
        return { ok: true, data: clone(project), events: [domainEvent] };
      });
    }
    ,changeProjectStatus(command, context) {
      validateContext(context); const permission = command.status === 'Cerrado' ? 'project:close' : 'project:update'; if (!authorizer.allows(context, permission)) return denied(permission, context);
      return executeIdempotent(context, () => {
        const project = repository.findById(context.tenantId, command.projectId);
        if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado', correlationId: context.correlationId }, events: [] };
        if (!canTransitionStatus(project.status, command.status)) return rejected('INVALID_STATUS_TRANSITION', 'Transición de estado no permitida', context);
        ensureBoard(project); if (command.status === 'Cerrado' && (project.phases.some((phase) => phase.status !== 'Cerrada') || project.milestones.some((milestone) => milestone.status !== 'Cumplido') || project.tasks.some((task) => !task.archivedAt && !project.boardLists.find((list) => list.id === task.listId)?.isDone))) return rejected('PROJECT_HAS_PENDING_WORK', 'El proyecto tiene trabajo pendiente', context);
        const previousStatus = project.status; project.status = command.status; repository.save(project);
        const domainEvent = event('ProjectStatusChanged', context, { projectId: project.id, previousStatus, newStatus: project.status }); eventPublisher.publish(domainEvent);
        return { ok: true, data: clone(project), events: [domainEvent] };
      });
    }
    ,addParticipant(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'project:manage-members')) return denied('project:manage-members', context);
      return executeIdempotent(context, () => {
        const project = repository.findById(context.tenantId, command.projectId); const user = userDirectory.findById(context.tenantId, command.userId);
        if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Proyecto no encontrado', correlationId: context.correlationId }, events: [] };
        if (project.status === 'Cerrado') return closed(context);
        if (!user) return { ok: false, error: { code: 'CROSS_TENANT_PARTICIPANT', message: 'Participante fuera del tenant activo', correlationId: context.correlationId }, events: [] };
        if (project.participants.some((participant) => participant.userId === user.userId)) return { ok: true, data: clone(project), events: [] };
        const participant = { ...user, projectRole: command.projectRole }; project.participants.push(participant); repository.save(project);
        const domainEvent = event('ProjectParticipantAdded', context, { projectId: project.id, participantId: user.userId, projectRole: command.projectRole }); eventPublisher.publish(domainEvent);
        return { ok: true, data: clone(project), events: [domainEvent] };
      });
    }
    ,createPhase(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'phase:create')) return denied('phase:create', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); if (project.status === 'Cerrado') return closed(context); const phase = newPhase({ id: `phase-${context.requestId}`, tenantId: context.tenantId, projectId: project.id, name: command.name, order: project.phases.length + 1 }); project.phases.push(phase); repository.save(project); return publishResult('ProjectPhaseCreated', context, { phaseId: phase.id, projectId: project.id }, phase); });
    }
    ,createMilestone(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'milestone:create')) return denied('milestone:create', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); if (project.status === 'Cerrado') return closed(context); const milestone = newMilestone({ id: `milestone-${context.requestId}`, tenantId: context.tenantId, projectId: project.id, phaseId: command.phaseId, name: command.name, targetDate: command.targetDate }); project.milestones.push(milestone); repository.save(project); return publishResult('ProjectMilestoneCreated', context, { milestoneId: milestone.id, projectId: project.id }, milestone); });
    }
    ,changePhaseStatus(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'phase:update')) return denied('phase:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); if (project.status === 'Cerrado') return closed(context); const phase = project.phases.find((item) => item.id === command.phaseId); if (!phase) return notFound(context); if (!canTransitionPhaseStatus(phase.status, command.status)) return invalidTransition(context); const previousStatus = phase.status; phase.status = command.status; repository.save(project); return publishResult('ProjectPhaseStatusChanged', context, { entityId: phase.id, previousValue: previousStatus, newValue: phase.status }, phase); });
    }
    ,completeMilestone(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'milestone:update')) return denied('milestone:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); if (project.status === 'Cerrado') return closed(context); const milestone = project.milestones.find((item) => item.id === command.milestoneId); if (!milestone) return notFound(context); if (milestone.status === 'Cumplido') return rejected('MILESTONE_ALREADY_COMPLETED', 'El hito ya fue cumplido', context); milestone.status = 'Cumplido'; repository.save(project); return publishResult('ProjectMilestoneCompleted', context, { entityId: milestone.id, newValue: 'Cumplido' }, milestone); });
    }
    ,createWorkItem(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:create')) return denied('task:create', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); ensureBoard(project); if (project.status === 'Cerrado') return closed(context); if (command.parentTaskId && !project.tasks.some((task) => task.id === command.parentTaskId)) return notFound(context); const task = newWorkItem({ id: `task-${context.requestId}`, tenantId: context.tenantId, projectId: project.id, listId: defaultListId(project), ...command }); project.tasks.push(task); repository.save(project); return publishResult(command.parentTaskId ? 'SubtaskCreated' : 'TaskCreated', context, { taskId: task.id, projectId: project.id }, task); });
    }
    ,changeTaskStatus(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); ensureBoard(project); if (project.status === 'Cerrado') return closed(context); const task = project.tasks.find((item) => item.id === command.taskId); if (!task) return notFound(context); if (task.archivedAt) return rejected('TASK_ARCHIVED', 'La tarjeta está archivada', context, { taskId: task.id }); if (!canTransitionWorkStatus(task.status, command.status)) return invalidTransition(context); if (command.status === 'En curso' && task.status !== 'En curso' && project.tasks.filter((item) => !item.archivedAt && item.status === 'En curso').length >= WIP_LIMIT) return rejected('WIP_LIMIT_EXCEEDED', `El límite WIP de ${WIP_LIMIT} tareas en curso fue alcanzado`, context, { taskId: task.id, projectId: project.id }); const children = project.tasks.filter((item) => item.parentTaskId === task.id && !item.archivedAt); const blockers = task.dependencies.map((id) => project.tasks.find((item) => item.id === id)).filter((item) => item && !item.archivedAt); if (command.status === 'Completada' && (children.some((child) => child.status !== 'Completada') || blockers.some((item) => item.status !== 'Completada'))) return rejected('TASK_BLOCKED', 'La tarea tiene trabajo pendiente', context, { taskId: task.id, projectId: project.id }); const previousStatus = task.status; task.status = command.status; task.listId = project.boardLists.find((list) => list.name === command.status)?.id ?? task.listId; repository.save(project); return publishResult('TaskStatusChanged', context, { taskId: task.id, previousStatus, newStatus: task.status }, task); });
    }
    ,addTaskDependency(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:manage-dependencies')) return denied('task:manage-dependencies', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); if (project.status === 'Cerrado') return closed(context); const task = project.tasks.find((item) => item.id === command.taskId); const predecessor = project.tasks.find((item) => item.id === command.predecessorId); const dependsOn = (id, target, seen = new Set()) => { if (id === target) return true; if (seen.has(id)) return false; seen.add(id); const node = project.tasks.find((item) => item.id === id); return node?.dependencies.some((dependency) => dependsOn(dependency, target, seen)) ?? false; }; if (!task || !predecessor || task.id === predecessor.id || dependsOn(predecessor.id, task.id)) return rejected('INVALID_DEPENDENCY', 'Dependencia inválida o cíclica', context); if (!task.dependencies.includes(predecessor.id)) task.dependencies.push(predecessor.id); repository.save(project); return publishResult('TaskDependencyAdded', context, { taskId: task.id, predecessorId: predecessor.id }, task); });
    }
    ,updateWorkItem(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); if (project.status === 'Cerrado') return closed(context); const task = project.tasks.find((item) => item.id === command.taskId); if (!task) return notFound(context); if (task.status === 'Completada') return rejected('TASK_COMPLETED', 'La tarjeta completada es de sólo lectura', context, { taskId: task.id }); const previousAssignee = task.assignee; const previousPriority = task.priority; if (command.assignee?.trim()) task.assignee = command.assignee.trim(); if (command.priority) task.priority = command.priority; repository.save(project); return publishResult('TaskUpdated', context, { taskId: task.id, previousAssignee, previousPriority, assignee: task.assignee, priority: task.priority }, task); });
    }
    ,updateCard(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); if (project.status === 'Cerrado') return closed(context); if (task.status === 'Completada' || task.archivedAt) return rejected('TASK_READ_ONLY', 'La tarjeta no admite cambios', context, { taskId: task.id }); const startDate = command.startDate !== undefined ? command.startDate || null : task.startDate; const dueDate = command.dueDate !== undefined ? command.dueDate || null : task.dueDate; if (startDate && dueDate && startDate > dueDate) return rejected('TASK_DATE_INVALID', 'La fecha de inicio no puede ser posterior al vencimiento', context, { taskId: task.id }); if (command.name?.trim()) task.name = command.name.trim(); if (command.description !== undefined) task.description = String(command.description).trim(); if (command.assignee?.trim()) task.assignee = command.assignee.trim(); if (command.priority) task.priority = command.priority; task.startDate = startDate; task.dueDate = dueDate; repository.save(project); return publishResult('CardUpdated', context, { taskId: task.id }, task); });
    }
    ,addChecklistItem(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); if (project.status === 'Cerrado' || task.status === 'Completada' || task.archivedAt) return rejected('TASK_READ_ONLY', 'La tarjeta no admite cambios', context, { taskId: task.id }); if (!command.text?.trim()) return rejected('CHECKLIST_ITEM_INVALID', 'El elemento del checklist es obligatorio', context, { taskId: task.id }); const item = { id: `check-${context.requestId}`, text: command.text.trim(), completed: false }; task.checklist.push(item); repository.save(project); return publishResult('ChecklistItemAdded', context, { taskId: task.id, checklistItemId: item.id }, item); });
    }
    ,toggleChecklistItem(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); if (project.status === 'Cerrado' || task.status === 'Completada' || task.archivedAt) return rejected('TASK_READ_ONLY', 'La tarjeta no admite cambios', context, { taskId: task.id }); const item = task.checklist.find((entry) => entry.id === command.checklistItemId); if (!item) return notFound(context); item.completed = Boolean(command.completed); repository.save(project); return publishResult('ChecklistItemChanged', context, { taskId: task.id, checklistItemId: item.id, completed: item.completed }, item); });
    }
    ,removeChecklistItem(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); if (project.status === 'Cerrado' || task.status === 'Completada' || task.archivedAt) return rejected('TASK_READ_ONLY', 'La tarjeta no admite cambios', context, { taskId: task.id }); const index = task.checklist.findIndex((entry) => entry.id === command.checklistItemId); if (index < 0) return notFound(context); const [item] = task.checklist.splice(index, 1); repository.save(project); return publishResult('ChecklistItemRemoved', context, { taskId: task.id, checklistItemId: item.id }, item); });
    }
    ,addAttachment(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); if (project.status === 'Cerrado' || task.status === 'Completada' || task.archivedAt) return rejected('TASK_READ_ONLY', 'La tarjeta no admite cambios', context, { taskId: task.id }); if (!command.name?.trim()) return rejected('ATTACHMENT_INVALID', 'El nombre del adjunto es obligatorio', context, { taskId: task.id }); const attachment = { id: `attachment-${context.requestId}`, name: command.name.trim(), url: command.url?.trim() || null }; task.attachments.push(attachment); repository.save(project); return publishResult('AttachmentAdded', context, { taskId: task.id, attachmentId: attachment.id }, attachment); });
    }
    ,addComment(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); if (project.status === 'Cerrado' || task.status === 'Completada' || task.archivedAt) return rejected('TASK_READ_ONLY', 'La tarjeta no admite cambios', context, { taskId: task.id }); if (!command.text?.trim()) return rejected('COMMENT_INVALID', 'El comentario es obligatorio', context, { taskId: task.id }); const comment = { id: `comment-${context.requestId}`, author: context.userId === 'user-admin' ? 'Administrador' : context.userId, text: command.text.trim(), occurredAt: new Date().toISOString() }; task.comments.push(comment); repository.save(project); return publishResult('CommentAdded', context, { taskId: task.id, commentId: comment.id }, comment); });
    }
    ,duplicateCard(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:create')) return denied('task:create', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const source = project?.tasks.find((item) => item.id === command.taskId); if (!project || !source) return notFound(context); ensureBoard(project); normalizeTask(source); if (project.status === 'Cerrado') return closed(context); const task = newWorkItem({ id: `task-${context.requestId}`, tenantId: context.tenantId, projectId: project.id, listId: defaultListId(project), name: `Copia de ${source.name}`, assignee: source.assignee, priority: source.priority, description: source.description, startDate: source.startDate, dueDate: source.dueDate, checklist: source.checklist.map((item, index) => ({ id: `check-${context.requestId}-${index}`, text: item.text, completed: false })) }); project.tasks.push(task); repository.save(project); return publishResult('CardDuplicated', context, { taskId: task.id, sourceTaskId: source.id }, task); });
    }
    ,archiveCard(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:archive')) return denied('task:archive', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); if (project.status === 'Cerrado') return closed(context); if (task.archivedAt) return rejected('TASK_ARCHIVED', 'La tarjeta ya está archivada', context, { taskId: task.id }); task.archivedAt = new Date().toISOString(); repository.save(project); return publishResult('CardArchived', context, { taskId: task.id }, task); });
    }
    ,addTimeEntry(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); initializeCostData(task); if (project.status === 'Cerrado' || task.archivedAt || task.status === 'Completada') return rejected('TASK_READ_ONLY', 'La tarjeta no admite registros', context, { taskId: task.id }); const hours = Number(command.hours); if (!command.date || !validHours(hours)) return rejected('TIME_ENTRY_INVALID', 'Las horas deben ser positivas, máximo 24 y en intervalos de 0,25', context, { taskId: task.id }); const assignee = command.assignee?.trim() || task.assignee; const sameDay = project.tasks.flatMap((item) => item.timeEntries ?? []).filter((entry) => entry.date === command.date && entry.assignee === assignee).reduce((total, entry) => total + entry.hours, 0); if (sameDay + hours > 24) return rejected('TIME_DAILY_LIMIT', 'La persona supera 24 horas en este proyecto y fecha', context, { taskId: task.id }); const hourlyRate = rateFor(assignee); const entry = { id: `time-${context.requestId}`, date: command.date, assignee, hours, hourlyRate, cost: hours * hourlyRate, description: command.description?.trim() || '', createdBy: context.userId, occurredAt: new Date().toISOString() }; task.timeEntries.push(entry); repository.save(project); return publishResult('TimeEntryAdded', context, { projectId: project.id, taskId: task.id, timeEntryId: entry.id }, entry); });
    }
    ,removeTimeEntry(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); initializeCostData(task); if (project.status === 'Cerrado' || task.archivedAt || task.status === 'Completada') return rejected('TASK_READ_ONLY', 'La tarjeta no admite cambios', context, { taskId: task.id }); const index = task.timeEntries.findIndex((entry) => entry.id === command.timeEntryId); if (index < 0) return notFound(context); const [entry] = task.timeEntries.splice(index, 1); repository.save(project); return publishResult('TimeEntryRemoved', context, { projectId: project.id, taskId: task.id, timeEntryId: entry.id }, entry); });
    }
    ,addCostEntry(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); initializeCostData(task); if (project.status === 'Cerrado' || task.archivedAt || task.status === 'Completada') return rejected('TASK_READ_ONLY', 'La tarjeta no admite registros', context, { taskId: task.id }); const amount = Number(command.amount); if (!command.date || !command.concept?.trim() || !Number.isFinite(amount) || amount <= 0) return rejected('COST_ENTRY_INVALID', 'Fecha, concepto y monto positivo son obligatorios', context, { taskId: task.id }); const entry = { id: `cost-${context.requestId}`, date: command.date, concept: command.concept.trim(), type: command.type || 'Otro', amount, createdBy: context.userId, occurredAt: new Date().toISOString() }; task.costEntries.push(entry); repository.save(project); return publishResult('CostEntryAdded', context, { projectId: project.id, taskId: task.id, costEntryId: entry.id }, entry); });
    }
    ,removeCostEntry(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); initializeCostData(task); if (project.status === 'Cerrado' || task.archivedAt || task.status === 'Completada') return rejected('TASK_READ_ONLY', 'La tarjeta no admite cambios', context, { taskId: task.id }); const index = task.costEntries.findIndex((entry) => entry.id === command.costEntryId); if (index < 0) return notFound(context); const [entry] = task.costEntries.splice(index, 1); repository.save(project); return publishResult('CostEntryRemoved', context, { projectId: project.id, taskId: task.id, costEntryId: entry.id }, entry); });
    }
    ,updateTaskEstimate(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); const task = project?.tasks.find((item) => item.id === command.taskId); if (!project || !task) return notFound(context); normalizeTask(task); initializeCostData(task); if (project.status === 'Cerrado' || task.archivedAt || task.status === 'Completada') return rejected('TASK_READ_ONLY', 'La tarjeta no admite cambios', context, { taskId: task.id }); const estimatedHours = command.estimatedHours === '' || command.estimatedHours === null ? null : Number(command.estimatedHours); const estimatedBudget = command.estimatedBudget === '' || command.estimatedBudget === null ? null : Number(command.estimatedBudget); if ((estimatedHours !== null && (!Number.isFinite(estimatedHours) || estimatedHours < 0)) || (estimatedBudget !== null && (!Number.isFinite(estimatedBudget) || estimatedBudget < 0))) return rejected('ESTIMATE_INVALID', 'Las estimaciones deben ser números positivos', context, { taskId: task.id }); task.estimatedHours = estimatedHours; task.estimatedBudget = estimatedBudget; repository.save(project); return publishResult('TaskEstimateUpdated', context, { projectId: project.id, taskId: task.id }, task); });
    }
    ,getProjectCostSummary(command, context) { validateContext(context); if (!authorizer.allows(context, 'project:read')) return denied('project:read', context); const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); project.tasks.forEach((task) => { normalizeTask(task); initializeCostData(task); }); return { ok: true, data: projectCostSummary(project), events: [] }; }
    ,createBoardList(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'project:update')) return denied('project:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); ensureBoard(project); if (project.status === 'Cerrado') return closed(context); if (!command.name?.trim() || project.boardLists.some((list) => !list.archivedAt && list.name.toLowerCase() === command.name.trim().toLowerCase())) return rejected('LIST_INVALID', 'El nombre de la lista es obligatorio y único', context, { projectId: project.id }); const list = { id: `list-${context.requestId}`, name: command.name.trim(), color: command.color || 'azul', position: project.boardLists.filter((item) => !item.archivedAt).length + 1, wipLimit: Number.isInteger(command.wipLimit) && command.wipLimit > 0 ? command.wipLimit : null, isDone: Boolean(command.isDone), archivedAt: null }; project.boardLists.push(list); repository.save(project); return publishResult('BoardListCreated', context, { projectId: project.id, listId: list.id }, list); });
    }
    ,updateBoardList(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'project:update')) return denied('project:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); ensureBoard(project); if (project.status === 'Cerrado') return closed(context); const list = project.boardLists.find((item) => item.id === command.listId && !item.archivedAt); if (!list) return notFound(context); if (command.name?.trim()) { if (project.boardLists.some((item) => item.id !== list.id && !item.archivedAt && item.name.toLowerCase() === command.name.trim().toLowerCase())) return rejected('LIST_INVALID', 'Ya existe una lista con ese nombre', context, { projectId: project.id, listId: list.id }); list.name = command.name.trim(); } if (command.color) list.color = command.color; if (command.wipLimit !== undefined) list.wipLimit = Number.isInteger(command.wipLimit) && command.wipLimit > 0 ? command.wipLimit : null; if (command.isDone !== undefined) { list.isDone = Boolean(command.isDone); if (list.isDone) project.tasks.filter((task) => !task.archivedAt && task.listId === list.id).forEach((task) => { task.status = 'Completada'; }); } repository.save(project); return publishResult('BoardListUpdated', context, { projectId: project.id, listId: list.id }, list); });
    }
    ,moveBoardList(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'project:update')) return denied('project:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); ensureBoard(project); if (project.status === 'Cerrado') return closed(context); const active = project.boardLists.filter((item) => !item.archivedAt).sort((a, b) => a.position - b.position); const index = active.findIndex((item) => item.id === command.listId); const target = index + (command.direction === 'left' ? -1 : 1); if (index < 0 || target < 0 || target >= active.length) return rejected('LIST_MOVE_INVALID', 'No se puede mover la lista', context, { projectId: project.id, listId: command.listId }); [active[index].position, active[target].position] = [active[target].position, active[index].position]; repository.save(project); return publishResult('BoardListMoved', context, { projectId: project.id, listId: command.listId }, active); });
    }
    ,archiveBoardList(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'project:update')) return denied('project:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); ensureBoard(project); if (project.status === 'Cerrado') return closed(context); const list = project.boardLists.find((item) => item.id === command.listId && !item.archivedAt); if (!list) return notFound(context); if (project.boardLists.filter((item) => !item.archivedAt).length <= 1) return rejected('LIST_ARCHIVE_INVALID', 'No se puede archivar la última lista', context, { projectId: project.id, listId: list.id }); if (project.tasks.some((task) => !task.archivedAt && task.listId === list.id)) return rejected('LIST_NOT_EMPTY', 'Mueve o archiva las tarjetas de esta lista antes de archivarla.', context, { projectId: project.id, listId: list.id }); list.archivedAt = new Date().toISOString(); repository.save(project); return publishResult('BoardListArchived', context, { projectId: project.id, listId: list.id }, list); });
    }
    ,deleteBoardList(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'project:update')) return denied('project:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); ensureBoard(project); if (project.status === 'Cerrado') return closed(context); const list = project.boardLists.find((item) => item.id === command.listId && !item.archivedAt); if (!list) return notFound(context); if (isDefaultBoardList(project, list)) return rejected('LIST_DELETE_FORBIDDEN', 'Las listas iniciales no se pueden eliminar', context, { projectId: project.id, listId: list.id }); const active = project.boardLists.filter((item) => !item.archivedAt); if (active.length <= 1) return rejected('LIST_DELETE_FORBIDDEN', 'No se puede eliminar la última lista activa', context, { projectId: project.id, listId: list.id }); if (project.tasks.some((task) => task.listId === list.id)) return rejected('LIST_NOT_EMPTY', 'No se puede eliminar una lista con tarjetas asociadas', context, { projectId: project.id, listId: list.id }); project.boardLists = project.boardLists.filter((item) => item.id !== list.id); project.boardLists.filter((item) => !item.archivedAt).sort((a, b) => a.position - b.position).forEach((item, index) => { item.position = index + 1; }); repository.save(project); return publishResult('BoardListDeleted', context, { projectId: project.id, listId: list.id, name: list.name }, list); });
    }
    ,moveTaskToList(command, context) {
      validateContext(context); if (!authorizer.allows(context, 'task:update')) return denied('task:update', context);
      return executeIdempotent(context, () => { const project = repository.findById(context.tenantId, command.projectId); if (!project) return notFound(context); ensureBoard(project); if (project.status === 'Cerrado') return closed(context); const task = project.tasks.find((item) => item.id === command.taskId); const destination = project.boardLists.find((item) => item.id === command.listId && !item.archivedAt); if (!task || !destination) return notFound(context); normalizeTask(task); if (task.archivedAt || project.boardLists.find((item) => item.id === task.listId)?.isDone) return rejected('TASK_READ_ONLY', 'La tarjeta no admite movimientos', context, { taskId: task.id }); if (destination.wipLimit && project.tasks.filter((item) => !item.archivedAt && item.listId === destination.id).length >= destination.wipLimit) return rejected('WIP_LIMIT_EXCEEDED', `El límite WIP de ${destination.wipLimit} tarjetas fue alcanzado`, context, { taskId: task.id, listId: destination.id }); const children = project.tasks.filter((item) => item.parentTaskId === task.id && !item.archivedAt); const dependencies = task.dependencies.map((id) => project.tasks.find((item) => item.id === id)).filter((item) => item && !item.archivedAt); if (destination.isDone && (children.some((item) => !project.boardLists.find((list) => list.id === item.listId)?.isDone) || dependencies.some((item) => !project.boardLists.find((list) => list.id === item.listId)?.isDone))) return rejected('TASK_BLOCKED', 'La tarjeta tiene trabajo pendiente', context, { taskId: task.id, listId: destination.id }); const previousListId = task.listId; task.listId = destination.id; task.status = destination.isDone ? 'Completada' : destination.name; repository.save(project); return publishResult('CardMoved', context, { taskId: task.id, previousListId, listId: destination.id }, task); });
    }
    ,getKanbanPolicy() { return { wipLimit: WIP_LIMIT }; }
  };

  function publishResult(type, context, payload, data) { const domainEvent = event(type, context, payload); eventPublisher.publish(domainEvent); return { ok: true, data: clone(data), events: [domainEvent] }; }
  function rejected(code, message, context, payload = {}) { const domainEvent = event('OperationRejected', context, { code, message, ...payload }); eventPublisher.publish(domainEvent); return { ok: false, error: { code, message, correlationId: context.correlationId }, events: [domainEvent] }; }
  function notFound(context) { return { ok: false, error: { code: 'NOT_FOUND', message: 'Entidad no encontrada', correlationId: context.correlationId }, events: [] }; }
  function closed(context) { return rejected('PROJECT_CLOSED', 'El proyecto está cerrado', context); }
  function invalidTransition(context) { return rejected('INVALID_STATUS_TRANSITION', 'Transición no permitida', context); }
  function ensureBoard(project) { if (!project.boardLists?.length) project.boardLists = initialBoardLists(project.id); const map = { Pendiente: 'pending', 'En curso': 'progress', Bloqueada: 'blocked', Completada: 'done' }; project.tasks.forEach((task) => { if (!task.listId) task.listId = `${project.id}-list-${map[task.status] ?? 'pending'}`; }); }
  function isDefaultBoardList(project, list) { return ['pending', 'progress', 'blocked', 'done'].some((suffix) => list.id === `${project.id}-list-${suffix}`); }
  function defaultListId(project) { return project.boardLists.find((list) => !list.archivedAt && !list.isDone)?.id ?? project.boardLists.find((list) => !list.archivedAt)?.id; }
  function normalizeTask(task) { task.description ??= ''; task.startDate ??= null; task.dueDate ??= null; task.checklist ??= []; task.attachments ??= []; task.comments ??= []; task.archivedAt ??= null; task.dependencies ??= []; initializeCostData(task); }
}
