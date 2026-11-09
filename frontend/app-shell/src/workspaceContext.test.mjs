import test from 'node:test';
import assert from 'node:assert/strict';
import {savedSelection, selectedCompany, validContext, validSpaces} from './workspaceContext.mjs';

test('saved workspace selection rejects malformed persisted values', () => {
  const malformed = {getItem: () => '{'};
  const unsafe = {getItem: () => JSON.stringify({tenant: 2, company: false})};
  assert.deepEqual(savedSelection(malformed), {tenant: '', company: ''});
  assert.deepEqual(savedSelection(unsafe), {tenant: '', company: ''});
});

test('workspace payload remains bound to its requested tenant', () => {
  const context = {tenant_id: 'tenant-a', companies: [{id: 'company-a', name: 'A'}], permissions: ['orders.read'], modules: ['erp.ecommerce']};
  assert.equal(validSpaces({spaces: [{id: 'tenant-a', name: 'Tenant A'}]}), true);
  assert.equal(validContext(context, 'tenant-a'), true);
  assert.equal(validContext(context, 'tenant-b'), false);
  assert.equal(selectedCompany(context), 'company-a');
});
