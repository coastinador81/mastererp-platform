import test from 'node:test';
import assert from 'node:assert/strict';
import {canOpenOperationsRoute} from './access.mjs';

const authorized = {
  modules: ['erp.operations'],
  permissions: ['operations.orders.read'],
};

test('requires the Operations module and route permission together', () => {
  assert.equal(canOpenOperationsRoute(authorized, 'orders'), true);
  assert.equal(canOpenOperationsRoute({...authorized, modules: []}, 'orders'), false);
  assert.equal(canOpenOperationsRoute({...authorized, permissions: []}, 'orders'), false);
});

test('does not grant a different Operations capability', () => {
  assert.equal(canOpenOperationsRoute(authorized, 'nodes'), false);
  assert.equal(canOpenOperationsRoute(authorized, 'unknown'), false);
});

test('requires the Ecommerce read permission for payment configuration', () => {
  assert.equal(canOpenOperationsRoute({...authorized, permissions: ['digital_sales.ecommerce.read']}, 'payments'), true);
  assert.equal(canOpenOperationsRoute({...authorized, permissions: []}, 'payments'), false);
});

test('requires the Transport module and driver read permission', () => {
  const drivers = {modules: ['erp.transport'], permissions: ['transport.drivers.read']};
  assert.equal(canOpenOperationsRoute(drivers, 'drivers'), true);
  assert.equal(canOpenOperationsRoute({...drivers, modules: ['erp.operations']}, 'drivers'), false);
  assert.equal(canOpenOperationsRoute({...drivers, permissions: []}, 'drivers'), false);
});
