import assert from 'node:assert/strict';
import test from 'node:test';
import { cartLinePrice, variantImageUrl } from './types.ts';

const cover = 'https://example.test/cover.png';
const photo = 'https://example.test/bbq.png';
const product = {id: 'product', price: 10, offer_price: 8, image_url: cover};
const bbq = {key: 'bbq', price_delta: 2, image_url: photo};
const variantProduct = {...product, attributes: {_catalog: {variants: [bbq]}}};

test('variant price matches checkout base plus adjustment and preserves legacy offer pricing', () => {
  assert.equal(cartLinePrice({product: variantProduct, variant: bbq}), 12);
  assert.equal(cartLinePrice({product: variantProduct, variant: {key: 'base'}}), 10);
  assert.equal(cartLinePrice({product}), 8);
});

test('variant images use only an assigned photo or explicitly associated cover', () => {
  assert.equal(variantImageUrl({product, variant: bbq}), photo);
  assert.equal(variantImageUrl({product, variant: {key: 'base', image_kind: 'compatible_cover', image_url: cover}}), cover);
  assert.equal(variantImageUrl({product, variant: {key: 'missing'}}), undefined);
  assert.equal(variantImageUrl({product}), cover);
});
