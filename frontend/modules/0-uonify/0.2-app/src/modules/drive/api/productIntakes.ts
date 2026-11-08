import { api } from '@/shared/api/client';
import type { ProductChange } from '@/shared/pim';

export interface ProductIntake {
  id: string;
  threadId: string;
  revision: number;
  status: 'selecting' | 'identified' | 'linked';
  folder?: { id: string; name: string };
  suggestedName?: string;
  product?: { sku: string; revision: number };
  productChanges?: ProductChange[];
}
export interface IntakeControl { threadId: string; revision: number; requestId: string }
const base = (id: string) => `/uony/product-intakes/${encodeURIComponent(id)}`;
export const productIntakeKey = (account: string, threadId: string, id: string) => ['product-intake', account, threadId, id] as const;
export const productIntakesApi = {
  get: (id: string, threadId: string, signal?: AbortSignal) => api.get<ProductIntake>(base(id), { params: { threadId }, signal }),
  folder: (id: string, data: IntakeControl & { folderId: string }, signal?: AbortSignal) => api.post<ProductIntake>(`${base(id)}/folder`, data, { signal }),
  product: (id: string, data: IntakeControl & { name: string }, signal?: AbortSignal) => api.post<ProductIntake>(`${base(id)}/product`, data, { signal }),
};
