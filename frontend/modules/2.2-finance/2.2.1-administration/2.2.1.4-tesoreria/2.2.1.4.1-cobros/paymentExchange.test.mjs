import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentExchange } from './paymentExchange.mjs';

test('prefills the server-derived payment exchange rate', () => {
  assert.deepEqual(paymentExchange({
    exchangeRate: '914.0218',
    exchangeRateEffectiveDate: '2026-11-16',
    exchangeRateSource: 'BCV',
  }), { rate: '914.0218', date: '2026-11-16', source: 'BCV' });
});

test('does not invent missing exchange-rate evidence', () => {
  assert.deepEqual(paymentExchange(), { rate: '', date: '', source: '' });
});
