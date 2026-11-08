import { api } from '@/shared/api/client';
import type { GoogleEffort } from '../hooks/googlePreferences';

export interface ContextRequest {
  threadId: string | null;
  text: string;
  model: string;
  effort: GoogleEffort;
  projectId: string | null;
  productContext: { sku: string; revision: number } | null;
}
export interface ContextMeasurement {
  status: 'measured' | 'unavailable';
  model: string;
  modelLabel: string;
  usedTokens: number | null;
  limitTokens: number | null;
  remainingTokens: number | null;
  usageRatio: number | null;
  measuredAt: string;
  historyTurns: number;
  historyLimit: number;
  measurement: 'google_count_tokens' | null;
  message?: string;
}

/** Cuenta la próxima entrada; no genera contenido ni consulta un saldo de pago. */
export function measureContext(body: ContextRequest, signal: AbortSignal): Promise<ContextMeasurement> {
  return api.post<ContextMeasurement>('/uony/context', body, { signal });
}
