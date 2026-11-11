const DAY = 86_400_000;
const parse = (value) => value ? new Date(`${value}T00:00:00`) : null;
const iso = (date) => date.toISOString().slice(0, 10);

export function isInvalidDateRange(startDate, dueDate) { return Boolean(startDate && dueDate && startDate > dueDate); }
export function plannedTask(task) { return Boolean(task.startDate || task.dueDate); }
export function taskSchedule(task) {
  if (!plannedTask(task)) return { kind: 'unscheduled' };
  if (isInvalidDateRange(task.startDate, task.dueDate)) return { kind: 'invalid' };
  if (!task.startDate) return { kind: 'milestone', date: task.dueDate };
  return { kind: 'bar', startDate: task.startDate, dueDate: task.dueDate ?? task.startDate };
}
export function ganttRange(anchor = new Date(), scale = 'month') {
  const date = new Date(anchor); date.setHours(0, 0, 0, 0);
  if (scale === 'week') { const offset = (date.getDay() + 6) % 7; date.setDate(date.getDate() - offset); const end = new Date(date); end.setDate(end.getDate() + 6); return { start: iso(date), end: iso(end), days: 7 }; }
  if (scale === 'quarter') { const start = new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1); const end = new Date(start.getFullYear(), start.getMonth() + 3, 0); return { start: iso(start), end: iso(end), days: Math.round((end - start) / DAY) + 1 }; }
  const start = new Date(date.getFullYear(), date.getMonth(), 1); const end = new Date(date.getFullYear(), date.getMonth() + 1, 0); return { start: iso(start), end: iso(end), days: Math.round((end - start) / DAY) + 1 };
}
export function barPlacement(schedule, range) {
  if (schedule.kind !== 'bar' && schedule.kind !== 'milestone') return null;
  const rangeStart = parse(range.start); const rangeEnd = parse(range.end); const start = parse(schedule.startDate ?? schedule.date); const end = parse(schedule.dueDate ?? schedule.date);
  if (end < rangeStart || start > rangeEnd) return null;
  const visibleStart = start < rangeStart ? rangeStart : start; const visibleEnd = end > rangeEnd ? rangeEnd : end;
  return { left: Math.max(0, Math.round(((visibleStart - rangeStart) / DAY) / range.days * 10000) / 100), width: schedule.kind === 'milestone' ? 1 : Math.max(1, Math.round((((visibleEnd - visibleStart) / DAY + 1) / range.days) * 10000) / 100) };
}
export function projectProgress(project) { const tasks = project.tasks.filter((task) => !task.archivedAt); const done = tasks.filter((task) => project.boardLists?.find((list) => list.id === task.listId)?.isDone || task.status === 'Completada').length; return { total: tasks.length, done, percent: tasks.length ? Math.round(done / tasks.length * 100) : 0 }; }
