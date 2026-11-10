import test from'node:test';
import assert from'node:assert/strict';
import{localDateKey,operationalOrdersByNode}from'./nodeUsage.mjs';

test('counts unique orders created or routed today by node',()=>{
  assert.deepEqual(operationalOrdersByNode({today:'2026-11-10',orders:[{id:'one',branch_id:'cartanal',created_at:'2026-11-10T10:00:00Z'}],routes:[{node_id:'cartanal',date:'2026-11-10',stops:[{order_id:'one'},{order_id:'two'}]},{node_id:'rosario',date:'2026-11-09',stops:[{order_id:'old'}]}]}),{cartanal:2});
});

test('builds the browser local calendar date',()=>{
  assert.equal(localDateKey(new Date(2026,10,10,23,30)),'2026-11-10');
});
