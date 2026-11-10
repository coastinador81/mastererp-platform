import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeOperations} from './summaryView.mjs';

test('excludes completed/cancelled preparations and counts only routes in progress', () => {
  const result = summarizeOperations({preparation: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(status => ({status})), routes: ['PLANNED', 'IN_ROUTE', 'COMPLETED'].map(status => ({status}))});
  assert.equal(result.preparing, 1); assert.equal(result.activeRoutes, 1);
});
test('today uses local date, separates currencies and excludes cancelled amounts', () => {
  const now = new Date(2026, 10, 10, 12), created_at = now.toISOString();
  const result = summarizeOperations({orders: [
    {created_at, status: 'PENDING', total: '10.50', currency: 'USD'},
    {created_at, status: 'OUT_FOR_DELIVERY', total: '20', currency: 'VES'},
    {created_at, status: 'CANCELLED', total: '100', currency: 'USD'},
    {created_at: new Date(2026, 10, 9, 12).toISOString(), total: '1000', currency: 'USD'},
  ]}, now);
  assert.equal(result.todayCount, 3); assert.equal(result.delivering, 1);
  assert.deepEqual(result.amounts, [['USD', 10.5], ['VES', 20]]);
});
test('empty orders do not invent a currency and recent orders are sorted without mutation', () => {
  assert.deepEqual(summarizeOperations({}).amounts, []);
  const orders = [{created_at: '2026-01-01'}, {created_at: '2026-02-01'}];
  assert.equal(summarizeOperations({orders}).recent[0], orders[1]);
  assert.equal(orders[0].created_at, '2026-01-01');
});
