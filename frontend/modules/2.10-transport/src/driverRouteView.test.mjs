import test from'node:test';import assert from'node:assert/strict';
import{filterRouteHistory,routeAllowsDelivery,routeLabel,routeTotals}from'./driverRouteView.mjs';
const route={id:'route-1',date:'2026-11-16',status:'COMPLETED',stops:[
 {order_id:'order-a',order_number:'ORD-AAA',status:'DELIVERED',customer:{name:'Ana'}},
 {order_id:'order-b',order_number:'ORD-BBB',status:'FAILED',customer:{name:'Luis'}}]};
test('summarizes closed route outcomes',()=>assert.deepEqual(routeTotals(route),{total:2,delivered:1,failed:1}));
test('searches route history by order or customer',()=>{assert.equal(filterRouteHistory([route],'ord-bbb').length,1);assert.equal(filterRouteHistory([route],'luis').length,1);assert.equal(filterRouteHistory([route],'missing').length,0)});
test('labels historical route states',()=>assert.equal(routeLabel('CANCELLED'),'Cancelada'));
test('enables delivery only after route start',()=>{assert.equal(routeAllowsDelivery({status:'ASSIGNED'}),false);assert.equal(routeAllowsDelivery({status:'IN_ROUTE'}),true)});
