import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryWindowRange, newestRoutes, readyOrdersForNode, routePayload, routeTimeOptions } from './routePlanning.mjs';

test('offers only READY orders without a route from the selected node', () => {
  const orders = [
    { id: 'ready', status: 'READY', branch_id: 'node-a', route_ref: null },
    { id: 'other-node', status: 'READY', branch_id: 'node-b', route_ref: null },
    { id: 'assigned', status: 'READY', branch_id: 'node-a', route_ref: 'route-1' },
    { id: 'preparing', status: 'PREPARING', branch_id: 'node-a', route_ref: null },
  ];
  assert.deepEqual(readyOrdersForNode(orders, 'node-a').map(order => order.id), ['ready']);
});

test('builds the existing route creation contract', () => {
  assert.deepEqual(routePayload({ nodeId: 'node-a', date: '2026-11-10', deliveryStart: '14:00', deliveryEnd: '17:00', orderIds: ['order-1'] }), {
    node_id: 'node-a', date: '2026-11-10', delivery_window_ref: '14:00-17:00', order_ids: ['order-1'],
  });
});

test('requires an ordered delivery time range', () => {
  assert.equal(deliveryWindowRange('14:00', '17:00'), '14:00-17:00');
  assert.equal(deliveryWindowRange('17:00', '14:00'), '');
  assert.equal(deliveryWindowRange('', '17:00'), '');
});

test('offers readable half-hour route windows and filters the ending time', () => {
  const options = routeTimeOptions();
  assert.equal(options.length, 48);
  assert.deepEqual(options.find(option => option.value === '14:30'), { value: '14:30', label: '2:30 p. m.' });
  assert.equal(routeTimeOptions('14:30')[0].value, '15:00');
});

test('orders routes by route date and creation date, newest first', () => {
  const routes = [
    { id: 'older-day', date: '2026-11-09', created_at: '2026-11-09T20:00:00Z' },
    { id: 'newer-today', date: '2026-11-10', created_at: '2026-11-10T18:00:00Z' },
    { id: 'older-today', date: '2026-11-10', created_at: '2026-11-10T12:00:00Z' },
  ];
  assert.deepEqual(newestRoutes(routes).map(route => route.id), ['newer-today', 'older-today', 'older-day']);
  assert.equal(routes[0].id, 'older-day');
});
