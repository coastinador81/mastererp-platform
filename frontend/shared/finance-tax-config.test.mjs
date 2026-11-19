import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExchangeRate, normalizeTaxRate, readFinanceConfig, writeFinanceConfig} from './finance-tax-config.mjs';

describe('finance general config', () => {
  const tenant = 'test-tenant-config';
  const bag = new Map();
  globalThis.localStorage = {
    getItem: key => bag.get(key) ?? null,
    setItem: (key, value) => bag.set(key, value),
    removeItem: key => bag.delete(key),
  };

  it('normalizes tax and exchange rates', () => {
    assert.equal(normalizeTaxRate(-1), '');
    assert.equal(normalizeTaxRate(16), 16);
    assert.equal(normalizeExchangeRate(0), '');
    assert.equal(normalizeExchangeRate(42.15), 42.15);
  });

  it('persists tax and exchange fields together', () => {
    writeFinanceConfig(tenant, {
      sale_tax_rate: 16,
      cost_tax_rate: 8,
      usd_exchange_rate: 40.5,
      eur_exchange_rate: 43.2,
    });
    assert.deepEqual(readFinanceConfig(tenant), {
      sale_tax_rate: 16,
      cost_tax_rate: 8,
      usd_exchange_rate: 40.5,
      eur_exchange_rate: 43.2,
    });
    bag.delete(`mastererp.finance.config.v1:${tenant}`);
  });
});