import { api } from '@/shared/api/client';
import type { BlenderJob, BlenderOperation, BlenderPair, BlenderState } from '../model/types';

const base = '/connections/blender-local';
const timeout = (signal?: AbortSignal) => ({ signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
export const blenderApi = {
  state: (productId?: string, signal?: AbortSignal) => api.get<BlenderState>(base, { ...timeout(signal), ...(productId ? { params: { productId } } : {}) }),
  pair: (pairId: string, signal?: AbortSignal) => api.get<BlenderPair>(`${base}/pair/${encodeURIComponent(pairId)}`, timeout(signal)),
  connect: (pairId: string, signal?: AbortSignal) => api.post<BlenderState>(`${base}/connect`, { pairId }, timeout(signal)),
  disconnect: (signal?: AbortSignal) => api.post<BlenderState>(`${base}/disconnect`, {}, timeout(signal)),
  start: (operation: BlenderOperation, requestId: string, productId: string) => api.post<{ job: BlenderJob }>(`${base}/${operation}`, { requestId, productId }, timeout()),
  job: (id: string) => api.get<{ job: BlenderJob }>(`${base}/jobs/${encodeURIComponent(id)}`, timeout()),
};
