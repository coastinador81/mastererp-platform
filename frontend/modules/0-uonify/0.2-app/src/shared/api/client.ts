import { apiUrl } from '@/shared/api/config';
import { emitPlanRequired, planRequiredFrom } from '@/shared/api/planRequired';

/** Error de la API con el estado HTTP y el cuerpo devuelto (como axios). */
export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  constructor(status: number, data: unknown, message?: string) {
    super(message ?? `La petición ha fallado (${status}).`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  responseType?: 'json' | 'blob' | 'text';
}

function withParams(url: string, params?: RequestOptions['params']): string {
  if (!params) return url;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined) search.set(key, String(value)); });
  const query = search.toString();
  return query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url;
}

/** Mensaje legible en español a partir del cuerpo de error del backend. */
export function errorMessage(error: unknown, fallback = 'No se ha podido completar. Inténtalo de nuevo.'): string {
  if (error instanceof ApiError) {
    const data = error.data as { message?: unknown; error?: unknown } | null;
    if (data && typeof data.message === 'string' && data.message.trim()) return data.message;
    return fallback;
  }
  if (error instanceof TypeError) return 'Sin conexión. Revisa tu red e inténtalo de nuevo.';
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Cliente HTTP de Uonify. La sesión viaja en una cookie HttpOnly (credentials:
 * 'include'); el navegador nunca guarda tokens de terceros.
 */
export async function request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: BodyInit | undefined;
  if (options.body instanceof FormData || options.body instanceof Blob) body = options.body;
  else if (options.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(withParams(apiUrl(path), options.params), {
    method,
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
  });
  const type = options.responseType ?? 'json';
  const read = async () => {
    if (type === 'blob') return response.blob();
    if (type === 'text') return response.text();
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch {
      // Un HTML del servidor de desarrollo no es una respuesta válida de la API.
      // No mostrar éxito ni repetir automáticamente operaciones como un cobro.
      throw new ApiError(response.status, { message: 'El servicio no ha respondido correctamente. Recarga la página e inténtalo de nuevo.' });
    }
  };
  const data = await read();
  if (!response.ok) {
    // 402 = muro de pago: se anuncia para que billing abra el aviso de suscripción.
    const paywall = planRequiredFrom(response.status, data);
    if (paywall) emitPlanRequired(paywall);
    throw new ApiError(response.status, data);
  }
  return data as T;
}

export const api = {
  get: <T = unknown>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  put: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  delete: <T = unknown>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};
