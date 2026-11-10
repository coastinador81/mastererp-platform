import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPayer, payerError } from './payer.mjs';

test('normalizes payer details before checkout', () => {
  assert.deepEqual(cleanPayer('mobile', { bankCode: ' 0102 ', document: 'v 1234 5678', phone: '0412-123-4567', holder: 'Ana' }),
    { bankCode: '0102', document: 'V12345678', phone: '04121234567', holder: undefined });
  assert.deepEqual(cleanPayer('transfer', { bankCode: '0105', document: 'J123456789', holder: ' Ana Pérez ' }),
    { bankCode: '0105', document: 'J123456789', phone: undefined, holder: 'Ana Pérez' });
});

test('requires the same payer fields the backend validates', () => {
  assert.equal(payerError('cash', {}), '');
  assert.equal(payerError('mobile', cleanPayer('mobile', { bankCode: '0102', document: 'V12345678', phone: '04121234567' })), '');
  assert.match(payerError('mobile', cleanPayer('mobile', { bankCode: '0102', document: 'V12345678' })), /teléfono/);
  assert.match(payerError('transfer', cleanPayer('transfer', { bankCode: '12', document: 'V12345678' })), /banco/);
  assert.match(payerError('transfer', cleanPayer('transfer', { bankCode: '0105', document: '123' })), /cédula/);
});
