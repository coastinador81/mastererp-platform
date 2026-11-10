import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQueue, canComplete, progressOf } from './preparationQueue.mjs';

const order = (id, status, created_at) => ({ id, status, created_at, items: [{ id: `${id}-l1` }, { id: `${id}-l2` }] });

test('queue lists confirmed, preparing and ready orders by arrival', () => {
  const queue = buildQueue([order('b', 'PREPARING', '2026-11-10T10:00:00Z'), order('a', 'CONFIRMED', '2026-11-10T09:00:00Z'), order('c', 'PENDING', '2026-11-10T08:00:00Z'), order('d', 'READY', '2026-11-10T11:00:00Z')], []);
  assert.deepEqual(queue.map(entry => [entry.order.id, entry.stage]), [['a', 'NOT_STARTED'], ['b', 'NOT_STARTED'], ['d', 'READY']]);
  assert.equal(queue[0].items.length, 2);
});

test('started preparation drives progress and completion', () => {
  const preparation = { order_id: 'b', status: 'IN_PROGRESS', version: 3, items: [{ line_id: 'b-l1', status: 'DONE', version: 2 }, { line_id: 'b-l2', status: 'PENDING', version: 1 }] };
  const [entry] = buildQueue([order('b', 'PREPARING', '2026-11-10T10:00:00Z')], [preparation]);
  assert.equal(entry.stage, 'IN_PROGRESS');
  assert.equal(entry.items[0].line.id, 'b-l1');
  assert.equal(progressOf(entry), 50);
  assert.equal(canComplete(entry), false);
  entry.items[1].status = 'DONE';
  assert.equal(canComplete(entry), true);
});
