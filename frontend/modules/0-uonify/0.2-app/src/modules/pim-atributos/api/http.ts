import { ApiError } from '@/shared/api/client';

/**
 * Utilidades de las llamadas de Atributos: tiempo máximo (los timeouts de axios
 * del original), respuestas tipo Lambda ({ body: string }) y mensajes de error.
 */

/** Ejecuta `run` con una señal que aborta a los `ms` milisegundos. */
export async function timed<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout of ${ms}ms exceeded`)), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Una respuesta de Lambda trae el resultado en `body` (texto JSON u objeto). */
export function unwrapBody<T = Record<string, unknown>>(data: unknown): T {
  const raw = (data ?? {}) as { body?: unknown };
  if (typeof raw.body === 'string') {
    try {
      return JSON.parse(raw.body) as T;
    } catch {
      return {} as T;
    }
  }
  if (raw.body && typeof raw.body === 'object') return raw.body as T;
  return raw as T;
}

/** error.response.data.error || error.response.data.message || error.message (como axios). */
export function apiErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const data = (error.data ?? {}) as { error?: unknown; message?: unknown };
    if (typeof data.error === 'string' && data.error) return data.error;
    if (typeof data.message === 'string' && data.message) return data.message;
    return `Request failed with status code ${error.status}`;
  }
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}
