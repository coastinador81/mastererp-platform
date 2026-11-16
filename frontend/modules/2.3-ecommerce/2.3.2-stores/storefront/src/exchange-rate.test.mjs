import assert from 'node:assert/strict';
import test from 'node:test';
import {formatVes, parseExchangeRate} from './exchange-rate.mjs';

test('normalizes the real BCV provider contract without a fallback rate', () => {
  assert.deepEqual(parseExchangeRate({USD:'914.0218',effective_date:'2026-11-16',updated_at:'today'}), {
    base:'USD',quote:'VES',rate:914.0218,source:'bcv.today',effectiveDate:'2026-11-16',updatedAt:'today',
  });
  assert.equal(parseExchangeRate({USD:0}), null);
  assert.equal(parseExchangeRate({USD:'invalid'}), null);
});

test('formats every VES amount as Venezuelan bolívares', () => {
  assert.equal(formatVes(102370.44), '102.370,44 Bs');
});
