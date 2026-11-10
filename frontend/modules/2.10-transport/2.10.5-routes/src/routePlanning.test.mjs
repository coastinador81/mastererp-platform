import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryWindowRange, readyOrdersForNode, routePayload } from './routePlanning.mjs';

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
