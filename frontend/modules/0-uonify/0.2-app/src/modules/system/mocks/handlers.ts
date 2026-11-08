import { http } from 'msw';
import { HttpResponse, mock } from '@/shared/mocks/utils';

// Comprobación de vida de la simulación del backend.
export const handlers = [
  http.get(mock('/health'), () => HttpResponse.json({ ok: true, mocked: true })),
];
