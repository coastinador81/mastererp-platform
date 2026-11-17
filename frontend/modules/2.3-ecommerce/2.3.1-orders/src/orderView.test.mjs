import test from 'node:test';
import assert from 'node:assert/strict';
import {eventReasonLabel,operationalHistory} from './orderView.js';

test('translates internal order event codes for users',()=>{
  assert.equal(eventReasonLabel('STOREFRONT_CHECKOUT'),'Pedido realizado en la tienda');
  assert.equal(eventReasonLabel('PAYMENT_VALIDATED'),'Pago validado');
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
