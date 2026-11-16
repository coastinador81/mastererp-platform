import assert from 'node:assert/strict';
import test from 'node:test';
import {formatBcvRate, millisecondsUntilNextBcvRefresh, parseBcvRate} from './bcv-rate.mjs';

test('normaliza la tasa BCV válida y conserva su fecha valor', () => {
  assert.deepEqual(parseBcvRate({USD: '52.7500', effective_date: '2026-11-16'}), {
    rate: 52.75,
    effectiveDate: '2026-11-16',
  });
});

test('rechaza tasas ausentes, negativas o no numéricas', () => {
  for (const value of [undefined, '', 0, -1, 'no-disponible']) {
    assert.equal(parseBcvRate({USD: value}), null);
  }
});

test('presenta la tasa con precisión útil sin ceros innecesarios', () => {
  assert.equal(formatBcvRate(52.75), '52,75');
  assert.equal(formatBcvRate(52.7534), '52,7534');
});

test('programa actualizaciones después de las 9 y 2 en hora de Venezuela', () => {
  assert.equal(millisecondsUntilNextBcvRefresh(new Date('2026-11-16T12:00:00Z')), 65 * 60 * 1000);
  assert.equal(millisecondsUntilNextBcvRefresh(new Date('2026-11-16T15:00:00Z')), 185 * 60 * 1000);
  assert.equal(millisecondsUntilNextBcvRefresh(new Date('2026-11-16T19:00:00Z')), 18 * 3600000 + 5 * 60000);
});
