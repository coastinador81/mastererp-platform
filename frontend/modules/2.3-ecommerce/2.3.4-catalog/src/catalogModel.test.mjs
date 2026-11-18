import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogHref, catalogRequest, cellText, csvCell, definitions, exportCsv, filterRecords, generateProductVariants, payloadFor} from './catalogModel.mjs';

test('links preserve independent and legacy catalog entrypoints', () => {
  assert.equal(catalogHref('products', 'a/b', 'view', '#/products'), '#/products/a%2Fb/view');
  assert.equal(catalogHref('products', null, 'new', '#/modulos/catalogo/productos'), '#/modulos/catalogo/productos/new');
  assert.equal(catalogHref('brands', null, 'view', '#/modulos/catalogo/marcas/marca/view'), '#/modulos/catalogo/marcas');
});

test('updates whitelist contract fields and preserve optimistic versions', () => {
  assert.deepEqual(payloadFor('products', {name: 'Café', price: 2, status: 'DRAFT', stock: 900, tax: 16, code: 'overwritten', id: 'other'}, {version: 4}), {name: 'Café', price: 2, status: 'DRAFT', version: 4});
  assert.deepEqual(payloadFor('categories', {name: 'Bebidas', slug: 'other', status: 'INACTIVE'}, {version: 3}), {name: 'Bebidas', status: 'INACTIVE', version: 3});
});
test('empty optional product relations are normalized', () => {
  assert.deepEqual(payloadFor('products', {name: 'Café', price: 2, status: 'ACTIVE', brand_ref: ''}, {version: 1}), {name: 'Café', price: 2, status: 'ACTIVE', brand_ref: null, version: 1});
});
test('creation uses existing identifiers and does not invent draft states', () => {
  assert.deepEqual(payloadFor('brands', {name: 'Marca', slug: 'marca', status: 'DRAFT'}), {name: 'Marca', slug: 'marca'});
  assert.deepEqual(payloadFor('attributes', {name: 'Color', code: 'color', type: 'SELECT', options: ['Rojo']}), {name: 'Color', options: ['Rojo'], code: 'color', type: 'SELECT'});
  assert.equal(definitions.categories.statuses.includes('DRAFT'), false);
});
test('supplier editing preserves additional contact and terms fields', () => {
  const draft = {name: 'Proveedor', status: 'ACTIVE', contact: {email: 'a@example.test', address: 'Dirección existente'}, terms: {payment_days: 30, currency: 'USD'}};
  assert.deepEqual(payloadFor('suppliers', draft, {version: 2}), {...draft, version: 2});
});
test('filter respects status and case without mutating source records', () => {
  const items = [{name: 'Café', code: 'REF-1', status: 'ACTIVE'}, {name: 'Café', code: 'REF-2', status: 'DRAFT'}];
  assert.deepEqual(filterRecords(items, 'ref-', 'DRAFT', definitions.products), [items[1]]);
  assert.equal(items.length, 2);
});
test('exports quote CSV and neutralize spreadsheet formulas', () => {
  assert.equal(csvCell('  =1+1'), '"\'  =1+1"');
  assert.equal(csvCell('a"b'), '"a""b"');
  const csv = exportCsv([{name: '+cmd', slug: 'brand', status: 'ACTIVE'}], definitions.brands);
  assert.ok(csv.includes('"\'+cmd"'));
  assert.ok(csv.includes('Activo'));
});
test('absent backend data is not presented as zero stock or product count', () => {
  assert.equal(cellText({}, 'product_count'), '—');
  assert.equal(definitions.products.columns.some(([field]) => field === 'stock'), false);
  assert.equal(cellText({product_count: 0}, 'product_count'), '0');
});
test('requests preserve runtime authentication and tenant isolation', async () => {
  let captured;
  const runtime = {api: 'https://example.test', tenant: 'tenant-a', request: async (...args) => {captured = args; return {items: []};}};
  await catalogRequest(runtime, '/v1/products', {method: 'POST', body: '{}', headers: {'Idempotency-Key': 'key'}});
  assert.equal(captured[0], 'https://example.test/v1/products');
  assert.equal(captured[1].headers['X-Tenant-Id'], 'tenant-a');
  assert.equal(captured[1].headers['Idempotency-Key'], 'key');
  await assert.rejects(catalogRequest({...runtime, tenant: ''}, '/v1/products'));
});
test('backend failures propagate without synthetic success', async () => {
  await assert.rejects(catalogRequest({api: 'https://example.test', tenant: 'a', request: async () => {throw Error('403');}}, '/v1/products'), /403/);
});
test('variant generation combines selected attribute values and preserves edits', () => {
  const attributes = [{code: 'color', options: ['Rojo', 'Azul']}, {code: 'size', options: ['S', 'M']}];
  const initial = generateProductVariants(['color', 'size'], attributes);
  assert.equal(initial.length, 4);
  const edited = [{...initial[0], sku: 'SKU-1'}];
  assert.equal(generateProductVariants(['color', 'size'], attributes, edited)[0].sku, 'SKU-1');
});
