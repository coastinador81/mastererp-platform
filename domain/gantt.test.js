import test from 'node:test';
import assert from 'node:assert/strict';
import { barPlacement, ganttRange, isInvalidDateRange, projectProgress, taskSchedule } from './gantt.js';

test('gantt identifies invalid and unscheduled task dates', () => {
  assert.equal(isInvalidDateRange('2026-12-10', '2026-12-01'), true);
  assert.equal(taskSchedule({}).kind, 'unscheduled');
  assert.equal(taskSchedule({ dueDate: '2026-12-01' }).kind, 'milestone');
});
test('gantt calculates a visible bar placement within the range', () => {
  const range = ganttRange(new Date('2026-11-15T00:00:00'), 'month');
  const placement = barPlacement(taskSchedule({ startDate: '2026-11-10', dueDate: '2026-11-15' }), range);
  assert.ok(placement.left > 0); assert.ok(placement.width > 0);
});
test('gantt progress uses final board lists', () => {
  assert.deepEqual(projectProgress({ boardLists: [{ id: 'done', isDone: true }], tasks: [{ listId: 'done' }, { listId: 'todo' }] }), { total: 2, done: 1, percent: 50 });
});
