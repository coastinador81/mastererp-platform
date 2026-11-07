import test from 'node:test';
import assert from 'node:assert/strict';
import {closeDetail,detailFromHash,openDetail} from './operationView.mjs';

test('detail routes are reloadable and preserve the selected identifier',()=>{
  globalThis.window={location:{hash:'#/orders/order-7094/view'}};
  assert.equal(detailFromHash('orders'),'order-7094');
  assert.equal(detailFromHash('products'),'');
  openDetail('products','product/with space');
  assert.equal(window.location.hash,'/products/product%2Fwith%20space/view');
  closeDetail('products');
  assert.equal(window.location.hash,'/products');
});
