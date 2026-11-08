import { api } from '@/shared/api/client';

export interface AmazonState {
  connection: { status: 'disconnected' | 'connected'; sellerId?: string; marketplaceId?: string; connectedAt?: string };
  available: boolean;
  accessAllowed: boolean;
  setup: { httpsReady: boolean; applicationReady: boolean; credentialsReady: boolean; loginUri: string | null; redirectUri: string | null };
}
export interface AmazonIntent { sellerId: string; expiresAt: string }
export interface AmazonFlow { authUrl: string; flowId: string }
export interface AmazonFlowStatus { status: 'pending' | 'success' | 'error'; error?: string }
const base = '/connections/amazon';
const idPath = (kind: 'flows' | 'intents', id: string) => `${base}/${kind}/${encodeURIComponent(id)}`;

export const amazonApi = {
  state: (signal?: AbortSignal) => api.get<AmazonState>(base, { signal }),
  start: (intentId?: string) => api.post<AmazonFlow>(intentId ? `${idPath('intents', intentId)}/accept` : `${base}/start`, {}, { signal: AbortSignal.timeout(15_000) }),
  flow: (id: string) => api.get<AmazonFlowStatus>(idPath('flows', id), { signal: AbortSignal.timeout(10_000) }),
  cancel: (id: string) => api.delete(idPath('flows', id)),
  intent: (id: string, signal?: AbortSignal) => api.get<AmazonIntent>(idPath('intents', id), { signal }),
  disconnect: () => api.delete(base),
};
