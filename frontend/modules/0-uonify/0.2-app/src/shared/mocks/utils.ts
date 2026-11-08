import { delay, HttpResponse } from 'msw';
import { apiUrl } from '@/shared/api/config';

/** Ruta completa para un handler: mock('/video/projects') → «/api/video/projects». */
export const mock = (path: string) => apiUrl(path);

/** Latencia realista para que se vean los estados de carga. */
export const latency = (ms = 450) => delay(ms);

/** Error con el formato del backend: { error, message }. */
export function fail(status: number, message: string, error = 'error') {
  return HttpResponse.json({ error, message }, { status });
}

export { HttpResponse };
