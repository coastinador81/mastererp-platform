import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryCoordinates, driverPosition, locationErrorMessage } from './driverLocation.mjs';

test('keeps watching after an immediate provider error until precise GPS arrives', async () => {
  const position = { coords: { latitude: 10, longitude: -66, accuracy: 45 } }, started = Date.now();
  const geolocation = { watchPosition(resolve, reject) { reject({ code: 1 }); setTimeout(() => resolve(position), 8); return 7; }, clearWatch() {} };
  assert.equal(await driverPosition({ geolocation, permissions: { query: async () => ({ state: 'granted' }) }, timeoutMs: 40 }), position);
  assert.ok(Date.now() - started >= 7);
});

test('does not retry a permission that is actually denied', async () => {
  const geolocation = { watchPosition() { throw new Error('should not run'); } };
  await assert.rejects(driverPosition({ geolocation, permissions: { query: async () => ({ state: 'denied' }) } }), { code: 'LOCATION_DENIED' });
});

test('waits for the acquisition window when permission is granted but the provider fails', async () => {
  const started = Date.now(), geolocation = { watchPosition(resolve, reject) { reject({ code: 1 }); return 9; }, clearWatch() {} };
  await assert.rejects(driverPosition({ geolocation, permissions: { query: async () => ({ state: 'granted' }) }, timeoutMs: 12 }), { code: 'LOCATION_TIMEOUT' });
  assert.ok(Date.now() - started >= 10);
});

test('rejects evidence that exceeds the backend accuracy contract', () => {
  assert.deepEqual(deliveryCoordinates({ coords: { latitude: 10, longitude: -66, accuracy: 40 } }), { latitude: 10, longitude: -66, accuracy_meters: 40 });
  assert.throws(() => deliveryCoordinates({ coords: { latitude: 10, longitude: -66, accuracy: 120 } }), { code: 'LOCATION_INACCURATE', accuracy: 120 });
  assert.match(locationErrorMessage({ code: 'LOCATION_INACCURATE', accuracy: 4814088 }), /demasiado imprecisa/);
});

test('explains safe delivery contract failures returned by Routes', () => {
  assert.match(locationErrorMessage({ code: 'delivery_outside_radius' }), /fuera del radio permitido/);
  assert.match(locationErrorMessage({ code: 'route_not_active' }), /ruta todavía no está iniciada/);
  assert.match(locationErrorMessage({ code: 'order_not_on_route' }), /no pertenece a la ruta activa/);
  assert.match(locationErrorMessage({ code: 'invalid_gps' }), /rechazó la evidencia GPS/);
});
