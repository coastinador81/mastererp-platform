import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogHref, catalogRequest, cellText, csvCell, definitions, exportCsv, filterAttributesForSearch, filterRecords, filterSuppliersForSearch, generateProductVariants, packagingRequiresConversionFactor, payloadFor, productIdentificationFromRecord, productMeasureFromRecord, productPricingFromRecord, productSkuFromRecord, supplierIdentificationFromRecord} from './catalogModel.mjs';

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
test('product sku maps to external reference on create and attributes on update', () => {
  assert.deepEqual(payloadFor('products', {name: 'Café', price: 2, status: 'ACTIVE', sku: 'HAR-1', attributes: {_catalog: {attribute_codes: [], variants: []}}}), {
    name: 'Café', price: 2, status: 'ACTIVE', external_reference: 'HAR-1', attributes: {_catalog: {attribute_codes: [], variants: []}, sku: 'HAR-1'},
  });
  assert.deepEqual(payloadFor('products', {name: 'Café', price: 2, status: 'ACTIVE', sku: 'HAR-2'}, {version: 3}), {
    name: 'Café', price: 2, status: 'ACTIVE', attributes: {sku: 'HAR-2'}, version: 3,
  });
  assert.equal(productSkuFromRecord({external_reference: 'EXT-1'}), 'EXT-1');
  assert.equal(productSkuFromRecord({attributes: {sku: 'ATTR-1'}}), 'ATTR-1');
});
test('product identification fields persist in attributes and supplier relations', () => {
  assert.deepEqual(productIdentificationFromRecord({
    attributes: {sku: 'SKU-1', barcode: '750123', qr: 'https://example.test/p', supplier_identification: 'PROV-9'},
    suppliers: [{id: '1', supplier_code: 'ignored', preferred: true}],
  }), {sku: 'SKU-1', barcode: '750123', qr: 'https://example.test/p', supplier_identification: 'PROV-9'});
  assert.equal(supplierIdentificationFromRecord({suppliers: [{id: '1', supplier_code: 'LEG-2', preferred: true}]}), 'LEG-2');
  assert.deepEqual(payloadFor('products', {
    name: 'Café', price: 2, status: 'ACTIVE', sku: 'SKU-1', barcode: '750', qr: 'QR-1', supplier_identification: 'P-44',
    suppliers: [{id: 'a', supplier_code: '', preferred: true}],
    attributes: {_catalog: {attribute_codes: [], variants: []}},
  }, {version: 1}), {
    name: 'Café', price: 2, status: 'ACTIVE',
    attributes: {_catalog: {attribute_codes: [], variants: []}, sku: 'SKU-1', barcode: '750', qr: 'QR-1', supplier_identification: 'P-44'},
    suppliers: [{id: 'a', supplier_code: 'P-44', preferred: true}],
    version: 1,
  });
});
test('product measure fields persist in attributes', () => {
  assert.deepEqual(productMeasureFromRecord({attributes: {weight: 2.5, sale_unit: 'kg', packaging_unit: 'box', packaging_factor: 12, storage_type: 'refrigerated'}}), {
    weight: 2.5, sale_unit: 'kg', packaging_unit: 'box', packaging_factor: 12, storage_type: 'refrigerated',
  });
  assert.equal(packagingRequiresConversionFactor('box'), true);
  assert.equal(packagingRequiresConversionFactor('paquete'), true);
  assert.deepEqual(payloadFor('products', {
    name: 'Café', price: 2, status: 'ACTIVE', packaging_unit: 'paquete', packaging_factor: 6, storage_type: 'dry',
  }).attributes, {packaging_unit: 'paquete', packaging_factor: 6, storage_type: 'dry'});
  assert.deepEqual(payloadFor('products', {
    name: 'Café', price: 2, status: 'ACTIVE', weight: 1, sale_unit: 'liter', packaging_unit: 'box', packaging_factor: 6,
    attributes: {_catalog: {attribute_codes: [], variants: []}},
  }), {
    name: 'Café', price: 2, status: 'ACTIVE',
    attributes: {_catalog: {attribute_codes: [], variants: []}, weight: 1, sale_unit: 'liter', packaging_unit: 'box', packaging_factor: 6},
  });
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
test('product pricing fields persist in attributes', () => {
  assert.deepEqual(productPricingFromRecord({attributes: {cost_price: 5, pricing_currency: 'VES', profit_margin: 25, logistics_freight: 1.5, other_expenses: 0.5, logistics_freight_vat_exempt: true}}), {
    cost_price: 5, pricing_currency: 'VES', profit_margin: 25, logistics_freight: 1.5, other_expenses: 0.5,
    cost_price_vat_exempt: false, logistics_freight_vat_exempt: true, other_expenses_vat_exempt: false,
  });
  assert.equal(productPricingFromRecord({attributes: {}}).pricing_currency, 'USD');
  assert.deepEqual(payloadFor('products', {
    name: 'Café', price: 10, status: 'ACTIVE', cost_price: 4, pricing_currency: 'EUR', profit_margin: 30, logistics_freight: 2,
    attributes: {sale_tax_rate: 16, cost_tax_rate: 8, tax_rate: 12},
  }, {version: 2}).attributes, {cost_price: 4, pricing_currency: 'EUR', profit_margin: 30, logistics_freight: 2});
  assert.deepEqual(payloadFor('products', {
    name: 'Café', price: 10, status: 'ACTIVE', cost_price: 4, logistics_freight: 2, other_expenses: 1,
    logistics_freight_vat_exempt: true, other_expenses_vat_exempt: false,
  }, {version: 2}).attributes.logistics_freight_vat_exempt, true);
  assert.equal(payloadFor('products', {
    name: 'Café', price: 10, status: 'ACTIVE', cost_price: 4, other_expenses_vat_exempt: false,
  }, {version: 2}).attributes.other_expenses_vat_exempt, undefined);
  assert.equal(payloadFor('products', {
    name: 'Café', price: 10, status: 'ACTIVE', cost_price: 4, pricing_currency: 'EUR', logistics_freight: 2,
    attributes: {sale_tax_rate: 16, cost_tax_rate: 8, tax_rate: 12},
  }, {version: 2}).attributes.sale_tax_rate, undefined);
});
test('attribute search matches name, code and option values', () => {
  const attributes = [
    {code: 'color', name: 'Color', options: ['Rojo', 'Azul']},
    {code: 'talla', name: 'Talla', options: ['S', 'M']},
  ];
  assert.deepEqual(filterAttributesForSearch(attributes, 'rojo', []).map(item => item.code), ['color']);
  assert.deepEqual(filterAttributesForSearch(attributes, '', ['color']).map(item => item.code), ['talla']);
});
test('supplier search ranks local matches and ignores selected suppliers', () => {
  const suppliers = [
    {id: '1', name: 'Distribuidora Norte', code: 'DN-01', contact: {email: 'norte@example.test'}},
    {id: '2', name: 'Alimentos del Sur', code: 'ADS-2', contact: {phone: '+34 600 111 222'}},
    {id: '3', name: 'Logística Centro', code: 'LC-3'},
  ];
  assert.deepEqual(filterSuppliersForSearch(suppliers, 'norte', []).map(item => item.id), ['1']);
  assert.deepEqual(filterSuppliersForSearch(suppliers, '', ['1']).map(item => item.id), ['2', '3']);
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

test('variant generation rejects oversized selections before expanding them', () => {
  const attributes = Array.from({length: 20}, (_, index) => ({
    code: 'attribute-' + index,
    options: ['A', 'B', 'C'],
  }));
  assert.throws(
    () => generateProductVariants(attributes.map(attribute => attribute.code), attributes),
    /too_many_variants/,
  );
});

test('product save includes the variant image and presentation fields', () => {
  const variant = {
    key: 'base', values: {}, label: 'Presentación base', sku: 'SKU-1',
    image_url: 'https://example.test/presentation.png', image_kind: 'specific',
    net_content: '500 g', packaging_unit: 'BAG', sale_unit: 'UNIT', barcode: '12345678',
  };
  const payload = payloadFor('products', {
    name: 'Producto', price: 10, status: 'ACTIVE',
    attributes: {_catalog: {attribute_codes: [], variants: [variant]}},
  });
  assert.deepEqual(payload.attributes._catalog.variants, [variant]);
});
