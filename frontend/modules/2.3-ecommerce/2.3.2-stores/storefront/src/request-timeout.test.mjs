import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithTimeout } from './request-timeout.mjs';

test('returns the storefront response before the timeout', async () => {
  const response = { ok: true };
  assert.equal(await fetchWithTimeout(async () => response, '/catalog', {}, 20), response);
});

test('aborts a storefront request that exceeds the timeout', async () => {
  const waitingFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  await assert.rejects(
    fetchWithTimeout(waitingFetch, '/catalog', {}, 5),
    /La conexión está tardando demasiado/,
  );
});
