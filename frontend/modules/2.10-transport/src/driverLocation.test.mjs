import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryCoordinates, driverPosition, locationErrorMessage } from './driverLocation.mjs';

test('retries without high accuracy when the precise provider fails', async () => {
  const calls = [], position = { coords: { latitude: 10, longitude: -66, accuracy: 45 } };
  const geolocation = { getCurrentPosition(resolve, reject, options) { calls.push(options); calls.length === 1 ? reject({ code: 1 }) : resolve(position); } };
  assert.equal(await driverPosition({ geolocation, permissions: { query: async () => ({ state: 'granted' }) } }), position);
  assert.deepEqual(calls.map(call => call.enableHighAccuracy), [true, false]);
});

test('does not retry a permission that is actually denied', async () => {
  const geolocation = { getCurrentPosition(resolve, reject) { reject({ code: 1 }); } };
  await assert.rejects(driverPosition({ geolocation, permissions: { query: async () => ({ state: 'denied' }) } }), { code: 'LOCATION_DENIED' });
});

test('rejects evidence that exceeds the backend accuracy contract', () => {
  assert.deepEqual(deliveryCoordinates({ coords: { latitude: 10, longitude: -66, accuracy: 40 } }), { latitude: 10, longitude: -66, accuracy_meters: 40 });
  assert.throws(() => deliveryCoordinates({ coords: { latitude: 10, longitude: -66, accuracy: 120 } }), { code: 'LOCATION_INACCURATE', accuracy: 120 });
  assert.match(locationErrorMessage({ code: 'LOCATION_INACCURATE', accuracy: 4814088 }), /demasiado imprecisa/);
});
