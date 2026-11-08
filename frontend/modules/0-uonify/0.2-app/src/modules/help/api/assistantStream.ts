import { ApiError } from '@/shared/api/client';
import { apiUrl } from '@/shared/api/config';
import type { AssistantEvent, AssistantRequest } from '../model/types';
import { SUPPORT_PATHS } from './paths';

/**
 * Uony de soporte responde en un flujo NDJSON (una línea JSON por evento) para que la
 * respuesta aparezca mientras se escribe. El cliente común (@/shared/api/client) lee
 * la respuesta entera, así que aquí se lee el flujo con la misma cookie de sesión y
 * los mismos errores (ApiError con { error, message }).
 */
export function parseNdjsonLines(buffer: string, onEvent: (event: AssistantEvent) => void): string {
  let rest = buffer;
  let index = rest.indexOf('\n');
  while (index >= 0) {
    const line = rest.slice(0, index).trim();
    rest = rest.slice(index + 1);
    if (line) {
      try {
        onEvent(JSON.parse(line) as AssistantEvent);
      } catch {
        // Una línea rota no corta la respuesta: se ignora.
      }
    }
    index = rest.indexOf('\n');
  }
  return rest;
}

export async function streamAssistant(body: AssistantRequest, onEvent: (event: AssistantEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(apiUrl(SUPPORT_PATHS.assistant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(body),
    credentials: 'include',
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    throw new ApiError(response.status, data);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    parseNdjsonLines(`${await response.text()}\n`, onEvent);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer = parseNdjsonLines(buffer + decoder.decode(value, { stream: true }), onEvent);
  }
  parseNdjsonLines(`${buffer}${decoder.decode()}\n`, onEvent);
}
