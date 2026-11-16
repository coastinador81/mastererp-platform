import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryWindowRange, newestRoutes, nodeWorkingHours, readyOrdersForNode, routeDurationLabel, routePayload, routeTimeLabel, shiftRouteTime } from './routePlanning.mjs';

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

test('supports readable half-hour controls for a delivery window', () => {
  assert.equal(routeTimeLabel('14:30'), '2:30 p. m.');
  assert.equal(shiftRouteTime('14:30', 1), '15:00');
  assert.equal(shiftRouteTime('00:00', -1), '00:00');
  assert.equal(shiftRouteTime('14:30', -1, '14:30'), '14:30');
  assert.equal(routeDurationLabel('08:00', '12:30'), '4 h 30 min');
});

test('reads the delivery limits from the selected node contract', () => {
  assert.deepEqual(nodeWorkingHours({ opening_time: '08:00:00', closing_time: '17:30:00' }), { opening: '08:00', closing: '17:30' });
  assert.equal(nodeWorkingHours({ opening_time: null, closing_time: null }), null);
  assert.equal(nodeWorkingHours({ opening_time: '18:00:00', closing_time: '08:00:00' }), null);
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
