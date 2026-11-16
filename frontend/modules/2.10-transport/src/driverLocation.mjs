export const MAX_DELIVERY_ACCURACY_METERS = 100;

export async function driverPosition({ geolocation = globalThis.navigator?.geolocation, permissions = globalThis.navigator?.permissions, timeoutMs = 20000 } = {}) {
  if (!geolocation?.watchPosition) throw { code: 'LOCATION_UNAVAILABLE' };
  const permission = await permissions?.query?.({ name: 'geolocation' }).catch(() => null);
  if (permission?.state === 'denied') throw { code: 'LOCATION_DENIED' };
  return new Promise((resolve, reject) => {
    let watchId, bestPosition, settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (watchId !== undefined) geolocation.clearWatch?.(watchId);
      callback(value);
    };
    const timer = setTimeout(() => finish(bestPosition ? resolve : reject, bestPosition || { code: 'LOCATION_TIMEOUT' }), timeoutMs);
    watchId = geolocation.watchPosition(position => {
      const accuracy = position?.coords?.accuracy;
      if (!Number.isFinite(accuracy)) return;
      if (!bestPosition || accuracy < bestPosition.coords.accuracy) bestPosition = position;
      if (accuracy <= MAX_DELIVERY_ACCURACY_METERS) finish(resolve, position);
    }, problem => {
      if (problem?.code === 1 && permission?.state !== 'granted') finish(reject, { code: 'LOCATION_DENIED' });
    }, { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 });
  });
}

export function deliveryCoordinates(position) {
  const { latitude, longitude, accuracy } = position?.coords || {};
  if (![latitude, longitude, accuracy].every(Number.isFinite)) throw { code: 'LOCATION_UNAVAILABLE' };
  if (accuracy > MAX_DELIVERY_ACCURACY_METERS) throw { code: 'LOCATION_INACCURATE', accuracy };
  return { latitude, longitude, accuracy_meters: accuracy };
}

export function locationErrorMessage(problem) {
  if (problem?.code === 'LOCATION_DENIED') return 'La ubicación está bloqueada para este sitio. Permítela en el navegador y vuelve a intentarlo.';
  if (problem?.code === 'LOCATION_TIMEOUT') return 'El GPS tardó demasiado en responder. Muévete a un lugar abierto y vuelve a intentarlo.';
  if (problem?.code === 'LOCATION_INACCURATE') return `La ubicación es demasiado imprecisa (${Math.round(problem.accuracy).toLocaleString('es-VE')} m). Activa la ubicación precisa o intenta desde un teléfono con GPS.`;
  if (problem?.code === 'LOCATION_UNAVAILABLE') return 'El dispositivo no pudo obtener tu ubicación. Verifica que la ubicación del sistema esté activa.';
  return problem?.message || 'No se pudo registrar la entrega.';
}
