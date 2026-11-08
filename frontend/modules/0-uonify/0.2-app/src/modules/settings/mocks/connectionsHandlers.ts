import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { ENDPOINTS } from '../api/endpoints';
import { AMAZON_AUTH_DAYS, AMAZON_DATA_DELETION_DAYS } from '../model/connections';
import { inDays, mfaStatus, nowIso } from './helpers';
import { accountRecord, connectionsRecord } from './store';

/**
 * Conexiones (/api/connections). El navegador nunca recibe tokens: el backend
 * guarda las autorizaciones cifradas.
 *
 *   GET    /connections                  → { chatgpt, amazon, shopify }
 *   POST   /connections/chatgpt/connect  { returnTo } → real: { authUrl } · simulado: { connections }
 *   DELETE /connections/chatgpt          → Connections
 *   POST   /connections/amazon/connect   { returnTo } → real: { authUrl } (consentimiento en Seller Central) · simulado: { connections }
 *                                        403 mfa_required (sin verificación en dos pasos)
 *   POST   /connections/amazon/renew     → igual que connect; la autorización vuelve a durar 365 días
 *   DELETE /connections/amazon           → Connections (amazon.dataDeletionBy = hoy + 30 días)
 */
export const connectionsHandlers = [
  http.get(mock(ENDPOINTS.connections), async () => {
    await latency(300);
    return HttpResponse.json(connectionsRecord.get());
  }),

  http.post(mock(ENDPOINTS.connect('chatgpt')), async () => {
    await latency(900);
    const connections = connectionsRecord.update(current => ({
      ...current,
      chatgpt: { status: 'connected', email: accountRecord.get().email, plan: 'Plus', connectedAt: nowIso() },
    }));
    return HttpResponse.json({ connections });
  }),

  http.delete(mock(ENDPOINTS.disconnect('chatgpt')), async () => {
    await latency(500);
    return HttpResponse.json(connectionsRecord.update(current => ({ ...current, chatgpt: { status: 'disconnected', email: null, plan: null, connectedAt: null } })));
  }),

  ...[ENDPOINTS.connect('amazon'), ENDPOINTS.amazonRenew].map(path =>
    http.post(mock(path), async () => {
      await latency(1100);
      if (!mfaStatus().enabled) {
        return fail(403, 'Activa la verificación en dos pasos antes de conectar Amazon. Amazon lo exige para proteger los datos de tu tienda.', 'mfa_required');
      }
      const connections = connectionsRecord.update(current => ({
        ...current,
        amazon: {
          status: 'connected',
          marketplace: 'Amazon.es',
          sellerName: current.amazon.sellerName ?? 'Make It Possible Store',
          sellerId: current.amazon.sellerId ?? 'A2F9K7Q1X3ZB8M',
          authorizedAt: nowIso(),
          expiresAt: inDays(AMAZON_AUTH_DAYS),
          dataDeletionBy: null,
        },
      }));
      return HttpResponse.json({ connections });
    }),
  ),

  http.delete(mock(ENDPOINTS.disconnect('amazon')), async () => {
    await latency(600);
    return HttpResponse.json(connectionsRecord.update(current => ({
      ...current,
      amazon: {
        status: 'disconnected',
        marketplace: 'Amazon.es',
        sellerName: null,
        sellerId: null,
        authorizedAt: null,
        expiresAt: null,
        dataDeletionBy: current.amazon.status === 'disconnected' ? current.amazon.dataDeletionBy : inDays(AMAZON_DATA_DELETION_DAYS),
      },
    })));
  }),
];
