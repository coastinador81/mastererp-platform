import assert from 'node:assert/strict';
import test from 'node:test';
import {formatVes} from './exchange-rate.mjs';

test('formats every VES amount as Venezuelan bolívares', () => {
  assert.equal(formatVes(102370.44), '102.370,44 Bs');
});
