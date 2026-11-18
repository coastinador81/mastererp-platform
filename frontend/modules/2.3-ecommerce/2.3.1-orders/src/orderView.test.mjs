import test from 'node:test';
import assert from 'node:assert/strict';
import {NEXT,eventReasonLabel,operationalHistory,returnableItems} from './orderView.js';

test('offers cancellation before dispatch but not while goods are in route',()=>{
  assert.ok(NEXT.PENDING.includes('CANCELLED'));
  assert.ok(NEXT.CONFIRMED.includes('CANCELLED'));
  assert.ok(NEXT.PREPARING.includes('CANCELLED'));
  assert.ok(NEXT.READY.includes('CANCELLED'));
  assert.equal(NEXT.OUT_FOR_DELIVERY,undefined);
});

test('translates internal order event codes for users',()=>{
  assert.equal(eventReasonLabel('STOREFRONT_CHECKOUT'),'Pedido realizado en la tienda');
  assert.equal(eventReasonLabel('PAYMENT_VALIDATED'),'Pago validado');
  assert.equal(eventReasonLabel('Manual operation'),'Pedido cancelado manualmente');
  assert.equal(eventReasonLabel('PREPARATION_STARTED'),'Preparación iniciada');
  assert.equal(eventReasonLabel('ROUTE_STARTED'),'Ruta iniciada');
});

test('links a persisted route start event from the consolidated history',()=>{
  const routeId='67932655-9218-4793-898b-0a211c4dfc77';
  const [event]=operationalHistory([{id:'started',reason:'ROUTE_STARTED',detail:routeId,created_at:'2026-11-17T21:00:00Z'}],[]);
  assert.equal(event.route_id,routeId);
  assert.equal(event.detail,'');
});

test('consolidates historical route attempts without duplicating delivery events',()=>{
  const history=[{id:'created',reason:'ORDER_CREATED',created_at:'2026-11-16T10:00:00Z'},
    {id:'duplicated',reason:'DELIVERY_FAILED',created_at:'2026-11-16T12:00:00Z'}];
  const attempts=[{route_id:'route-1',status:'FAILED',driver_name:'Andrea',updated_at:'2026-11-16T12:00:00Z',evidence:{reason:'Cliente ausente'}}];
  const result=operationalHistory(history,attempts);
  assert.deepEqual(result.map(event=>event.reason),['ORDER_CREATED','DELIVERY_FAILED']);
  assert.equal(result[1].source,'routes');
  assert.equal(result[1].detail,'Cliente ausente');
});

test('includes return lifecycle events in the consolidated order history',()=>{
  const returns=[{id:'return-1',history:[
    {id:'event-1',status:'REQUESTED',detail:'Producto defectuoso',created_at:'2026-11-17T10:00:00Z'},
    {id:'event-2',status:'RECEIVED',detail:'Recepción física verificada',created_at:'2026-11-17T12:00:00Z'},
  ]}];
  const result=operationalHistory([],[],returns);
  assert.deepEqual(result.map(event=>event.reason),['RETURN_REQUESTED','RETURN_RECEIVED']);
  assert.equal(eventReasonLabel(result[1].reason),'Devolución recibida e inventario registrado');
});

test('only offers quantities not already committed to a return',()=>{
  const order={items:[{id:'line-1',quantity:1},{id:'line-2',quantity:3}]};
  const records=[{status:'RECEIVED',items:[{order_item_id:'line-1',requested_quantity:1},{order_item_id:'line-2',requested_quantity:2}]}];
  assert.deepEqual(returnableItems(order,records).map(item=>[item.id,item.returnable_quantity]),[['line-2',1]]);
});

test('rejected returns release their quantities for a new request',()=>{
  const order={items:[{id:'line-1',quantity:1}]};
  const records=[{status:'REJECTED',items:[{order_item_id:'line-1',requested_quantity:1}]}];
  assert.equal(returnableItems(order,records)[0].returnable_quantity,1);
});
