import { http } from 'msw';
import { HttpResponse, fail, latency, mock } from '@/shared/mocks/utils';
import { generateBullet, generateDescription, generateKeywords, type ProductInfo } from './fixtures/generator';

/**
 * Simulación de POST /ai-descriptions (Uony redacta la descripción, las
 * keywords o una viñeta). Éxito por defecto con la latencia de una IA real.
 */

// En las pruebas no se espera: la latencia solo sirve para ver los estados de carga.
const wait = (ms: number) => latency(import.meta.env.MODE === 'test' ? 0 : ms);

export const handlers = [
  http.post(mock('/ai-descriptions'), async ({ request }) => {
    const body = (await request.json()) as { product_info?: ProductInfo; field?: unknown } | null;
    const info = body?.product_info ?? {};
    const field = String(body?.field ?? '');
    if (field === 'description') {
      await wait(2200);
      return HttpResponse.json({ description: generateDescription(info) });
    }
    if (field === 'keywords') {
      await wait(1400);
      return HttpResponse.json({ keywords: generateKeywords(info) });
    }
    const feature = /^feature-(\d)$/.exec(field);
    if (feature) {
      await wait(1600);
      return HttpResponse.json({ bullets_array: [`• ${generateBullet(info, Number(feature[1]))}`] });
    }
    return fail(400, 'Campo no admitido por Uony.', 'Campo no admitido');
  }),
];
