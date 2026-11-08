import { ApiError, api } from '@/shared/api/client';
import type { GpsrPayload } from '../model/gpsr';

/**
 * «Guardar GPSR en Amazon» (apiService.updateGPSR del original):
 *   PATCH /amazon/products
 *   { …payload, gpsr_manufacturer_reference, new_source_location, gpsr_safety_attestation_value,
 *     content_type, content_language }  → { sku, status: 'ACCEPTED', submissionId, issues }
 * La sesión va en la cookie del backend (sin X-User-Id). Tiempo máximo: 300 s.
 * Los errores llevan los mensajes de axios del original.
 */
const AXIOS_TIMEOUT = 300_000;
export const GPSR_PATH = '/amazon/products';

export async function updateGPSR(data: GpsrPayload): Promise<unknown> {
  const body = {
    ...data,
    gpsr_manufacturer_reference: data.manufacturer_contact,
    new_source_location: data.compliance_document_url,
    gpsr_safety_attestation_value: data.safety_attestation,
    content_type: data.content_type || 'application/pdf',
    content_language: data.content_language || 'es_ES',
  };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, AXIOS_TIMEOUT);
  try {
    return await api.patch(GPSR_PATH, body, { headers: { Accept: 'application/json' }, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(`timeout of ${AXIOS_TIMEOUT}ms exceeded`, { cause: error });
    if (error instanceof ApiError) {
      const detail = (error.data as { error?: unknown } | null)?.error;
      throw new Error(typeof detail === 'string' && detail ? detail : `Request failed with status code ${error.status}`, { cause: error });
    }
    if (error instanceof TypeError) throw new Error('Network Error', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
