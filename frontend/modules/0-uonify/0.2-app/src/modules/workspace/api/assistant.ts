import { api } from '@/shared/api/client';
import type { UsageData } from '../model/usage';

/**
 * Contrato del espacio con el backend de Uony (simulado en mocks/handlers.ts).
 *
 *   GET  /api/ai/usage            → UsageData (límites de uso del compositor)
 *   POST /api/assistant/messages  → registra la petición con sus opciones de IA
 *                                   (modelo, esfuerzo, velocidad) y devuelve el uso;
 *                                   429 subscription_sharing_usage_limit_exceeded
 *                                   si el plan de ChatGPT llegó a su límite
 *
 * En el PROTO el uso llegaba de fuera (`UonifyComposerTools.setUsage`) y cada
 * mensaje ya guardaba modelo, esfuerzo y velocidad para enviarlos al backend.
 * La respuesta de Uony todavía la decide el enrutado local del prototipo.
 */
export const ASSISTANT_ENDPOINTS = {
  USAGE: '/ai/usage',
  MESSAGES: '/assistant/messages',
} as const;

export interface AssistantMessageRequest {
  threadId: string;
  service: string | null;
  text: string;
  model: string;
  effort: string;
  speed: string;
}

export interface AssistantMessageResponse {
  id: string;
  threadId: string;
  receivedAt: string;
  usage: UsageData;
  /** Lo descontado de los tokens de Uonify si el cliente eligió pagar con ellos. */
  charged?: { tokens: number; amount: number; currency: string } | null;
}

export function getUsage(signal?: AbortSignal): Promise<UsageData> {
  return api.get<UsageData>(ASSISTANT_ENDPOINTS.USAGE, { signal });
}

export function postAssistantMessage(body: AssistantMessageRequest): Promise<AssistantMessageResponse> {
  return api.post<AssistantMessageResponse>(ASSISTANT_ENDPOINTS.MESSAGES, body);
}
