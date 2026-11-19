import assert from 'node:assert/strict';
import test from 'node:test';
import {formatBcvRate, millisecondsUntilNextBcvRefresh} from './bcv-rate.mjs';

test('presenta la tasa con precisión útil sin ceros innecesarios', () => {
  assert.equal(formatBcvRate(52.75), '52,75');
  assert.equal(formatBcvRate(52.7534), '52,7534');
});

test('programa actualizaciones después de las 9 y 2 en hora de Venezuela', () => {
  assert.equal(millisecondsUntilNextBcvRefresh(new Date('2026-11-16T12:00:00Z')), 65 * 60 * 1000);
  assert.equal(millisecondsUntilNextBcvRefresh(new Date('2026-11-16T15:00:00Z')), 185 * 60 * 1000);
  assert.equal(millisecondsUntilNextBcvRefresh(new Date('2026-11-16T19:00:00Z')), 18 * 3600000 + 5 * 60000);
});
