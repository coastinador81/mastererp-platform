export const MAX_DELIVERY_ACCURACY_METERS = 100;

const locate = (geolocation, options) => new Promise((resolve, reject) => {
  if (!geolocation) return reject({ code: 'LOCATION_UNAVAILABLE' });
  geolocation.getCurrentPosition(resolve, reject, options);
});

export async function driverPosition({ geolocation = globalThis.navigator?.geolocation, permissions = globalThis.navigator?.permissions } = {}) {
  try {
    return await locate(geolocation, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  } catch (problem) {
    const permission = await permissions?.query?.({ name: 'geolocation' }).catch(() => null);
    if (permission?.state === 'denied') throw { code: 'LOCATION_DENIED' };
    try {
      return await locate(geolocation, { enableHighAccuracy: false, timeout: 20000, maximumAge: 30000 });
    } catch (fallbackProblem) {
      throw { code: fallbackProblem?.code === 3 ? 'LOCATION_TIMEOUT' : fallbackProblem?.code === 1 ? 'LOCATION_DENIED' : 'LOCATION_UNAVAILABLE' };
    }
  }
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
