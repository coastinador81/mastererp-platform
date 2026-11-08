import { daysUntil } from './format';
import type { AmazonConnection, ChatGptConnection } from './types';

/** La autorización de Amazon (Selling Partner API) dura 365 días; se avisa en los últimos 30. */
export const AMAZON_AUTH_DAYS = 365;
export const AMAZON_RENEW_WARNING_DAYS = 30;
/** Plazo de borrado de los datos de Amazon tras desconectar (política de protección de datos de Amazon). */
export const AMAZON_DATA_DELETION_DAYS = 30;

export type AmazonView =
  | { kind: 'needs-mfa' }
  | { kind: 'disconnected'; deletionBy: string | null }
  | { kind: 'connected'; daysLeft: number; renewSoon: boolean }
  | { kind: 'expired' }
  | { kind: 'revoked' };

/** Qué se enseña en la tarjeta de Amazon según la conexión y la verificación en dos pasos. */
export function amazonView(connection: AmazonConnection, mfaEnabled: boolean, now = Date.now()): AmazonView {
  if (connection.status === 'connected') {
    const daysLeft = daysUntil(connection.expiresAt, now);
    if (connection.expiresAt && daysLeft <= 0) return { kind: 'expired' };
    return { kind: 'connected', daysLeft, renewSoon: daysLeft <= AMAZON_RENEW_WARNING_DAYS };
  }
  if (connection.status === 'expired') return { kind: 'expired' };
  if (connection.status === 'revoked') return { kind: 'revoked' };
  if (!mfaEnabled) return { kind: 'needs-mfa' };
  return { kind: 'disconnected', deletionBy: connection.dataDeletionBy };
}

/** «Conectado», «Sin conectar» o «Caducado», con su tono. */
export function chatGptBadge(connection: ChatGptConnection): { label: string; tone: 'green' | 'neutral' | 'amber' } {
  if (connection.status === 'connected') return { label: 'Conectado', tone: 'green' };
  if (connection.status === 'expired') return { label: 'Caducado', tone: 'amber' };
  return { label: 'Sin conectar', tone: 'neutral' };
}

/** «ChatGPT Plus» a partir del plan que informa OpenAI. */
export function chatGptPlanLabel(plan: string | null): string {
  if (!plan) return 'ChatGPT';
  return /^chatgpt/i.test(plan) ? plan : `ChatGPT ${plan}`;
}

/** Id de vendedor enmascarado: «A1B2C3D4E5F6» → «A1B2••••E5F6». */
export function maskSellerId(id: string | null): string {
  if (!id) return '—';
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}••••${id.slice(-4)}`;
}
