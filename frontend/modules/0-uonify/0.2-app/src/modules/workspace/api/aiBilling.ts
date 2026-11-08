import { api } from '@/shared/api/client';
import { readTokenAmount, type TokenAmount } from '../model/aiLimit';
import type { AiPayer, UsageData } from '../model/usage';

/**
 * Forma de pago de Uony y tokens de Uonify (simulado en mocks/handlers.ts). El cliente
 * elige siempre: nada cambia la forma de pago sin su clic.
 *
 *   POST /api/ai/payer        { payer }            → { payer, scope: 'session', usage }
 *                                                   402 plan_required sin plan (muro de pago)
 *                                                   402 tokens_required sin tokens de Uonify
 *   GET  /api/ai/quote        ?model&effort&speed  → { tokens, amount, currency } por mensaje
 *   GET  /api/billing/balance                      → saldo (del módulo billing; solo se lee)
 *   PUT  /api/ai/simulation   { limitReached?, hasPlan? } → solo en la simulación (MSW):
 *                                                   el backend real no la tiene
 */
export const AI_BILLING_ENDPOINTS = {
  PAYER: '/ai/payer',
  QUOTE: '/ai/quote',
  SIMULATION: '/ai/simulation',
  BALANCE: '/billing/balance',
} as const;

export interface PayerResponse {
  payer: AiPayer;
  scope: 'session';
  usage?: UsageData;
}

export interface QuoteRequest {
  model: string;
  effort: string;
  speed: string;
}

export interface LimitSimulation {
  limitReached: boolean;
  hasPlan: boolean;
  usage?: UsageData;
}

export function choosePayer(payer: AiPayer): Promise<PayerResponse> {
  return api.post<PayerResponse>(AI_BILLING_ENDPOINTS.PAYER, { payer });
}

export async function getTokenQuote(request: QuoteRequest, signal?: AbortSignal): Promise<TokenAmount | null> {
  return readTokenAmount(await api.get<unknown>(AI_BILLING_ENDPOINTS.QUOTE, { params: { ...request }, signal }));
}

export async function getTokenBalance(signal?: AbortSignal): Promise<TokenAmount | null> {
  return readTokenAmount(await api.get<unknown>(AI_BILLING_ENDPOINTS.BALANCE, { signal }));
}

export function getLimitSimulation(signal?: AbortSignal): Promise<LimitSimulation> {
  return api.get<LimitSimulation>(AI_BILLING_ENDPOINTS.SIMULATION, { signal });
}

export function setLimitSimulation(patch: Partial<Omit<LimitSimulation, 'usage'>>): Promise<LimitSimulation> {
  return api.put<LimitSimulation>(AI_BILLING_ENDPOINTS.SIMULATION, patch);
}
