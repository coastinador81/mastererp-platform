import { http } from 'msw';
import { collection } from '@/shared/mocks/db';
import { HttpResponse, fail, latency, mock } from '@/shared/mocks/utils';

/**
 * Simulación de PATCH /amazon/products (datos GPSR de un listing de Amazon).
 * Éxito por defecto; sin SKU, el error que daría la Listings API.
 */

// En las pruebas no se espera: la latencia solo sirve para ver los estados de carga.
const wait = (ms: number) => latency(import.meta.env.MODE === 'test' ? 0 : ms);

interface GpsrRecord { id: string; [field: string]: unknown }
const gpsrRecords = collection<GpsrRecord>('amazon-gpsr');

export const handlers = [
  http.patch(mock('/amazon/products'), async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown> | null;
    const sku = String(body?.sku ?? '').trim();
    await wait(900);
    if (!sku) return fail(400, 'Guarda el producto con su SKU antes de enviar el GPSR a Amazon.', 'Falta el SKU del producto.');
    gpsrRecords.upsert({ ...(body ?? {}), id: sku, updatedAt: new Date().toISOString() });
    return HttpResponse.json({
      sku,
      status: 'ACCEPTED',
      submissionId: `sub-${Math.random().toString(36).slice(2, 10)}`,
      issues: [],
    });
  }),
];
