import test from'node:test';
import assert from'node:assert/strict';
import{driverAccess,driverAvailability,routeOutcome,driverStats}from'./driverView.mjs';

test('translates driver availability',()=>{
  assert.equal(driverAvailability('AVAILABLE'),'Disponible');
  assert.equal(driverAvailability('ON_ROUTE'),'En ruta');
  assert.equal(driverAccess('LINKED'),'Vinculado');
});

test('distinguishes a pending stop on a cancelled route',()=>{
  assert.equal(routeOutcome('CANCELLED','PENDING'),'No ejecutada (ruta cancelada)');
  assert.equal(routeOutcome('IN_ROUTE','FAILED'),'Entrega fallida');
});

test('counts actual stop outcomes',()=>{
  assert.deepEqual(driverStats([{stops:[{status:'DELIVERED'},{status:'FAILED'}]},{stops:[{status:'PENDING'}]}]),{delivered:1,failed:1,pending:1});
});
