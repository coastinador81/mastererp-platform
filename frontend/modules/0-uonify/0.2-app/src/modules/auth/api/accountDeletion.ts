import { api, ApiError } from '@/shared/api/client';

export interface AccountDeletionPreview {
  status: 'ready' | 'blocked' | 'pending' | 'error';
  email: string;
  confirmationText: 'ELIMINAR';
  requestId: string | null;
  counts: { products: number; conversations: number; connections: number };
  blockers: { code: string; message: string; count: number }[];
  canRetry: boolean;
  message: string;
}
export type AccountDeletionResult = { status: 'deleted'; redirectTo: '/' }
  | AccountDeletionPreview & { status: 'pending' | 'error' };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const invalid = () => new ApiError(502, { message: 'No podemos comprobar la información de tu cuenta. Vuelve a intentarlo.' });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function previewOf(value: unknown): AccountDeletionPreview {
  if (!record(value) || !['ready', 'blocked', 'pending', 'error'].includes(String(value.status))
    || typeof value.email !== 'string' || value.confirmationText !== 'ELIMINAR'
    || !(value.requestId === null || typeof value.requestId === 'string' && uuid.test(value.requestId))
    || !record(value.counts) || !['products', 'conversations', 'connections'].every(key => count((value.counts as Record<string, unknown>)[key]))
    || !Array.isArray(value.blockers) || !value.blockers.every(item => record(item) && typeof item.code === 'string' && typeof item.message === 'string' && count(item.count))
    || typeof value.canRetry !== 'boolean' || typeof value.message !== 'string') throw invalid();
  return value as unknown as AccountDeletionPreview;
}

export async function getAccountDeletion(signal?: AbortSignal): Promise<AccountDeletionPreview> {
  return previewOf(await api.get<unknown>('/account/deletion', { signal }));
}

export async function deleteAccount(body: { requestId: string; confirmation: 'ELIMINAR'; email: string }, signal?: AbortSignal): Promise<AccountDeletionResult> {
  const value = await api.post<unknown>('/account/deletion', body, { signal });
  if (!record(value) || !['deleted', 'pending', 'error'].includes(String(value.status))
    || value.status === 'deleted' && value.redirectTo !== '/') throw invalid();
  return value.status === 'deleted' ? { status: 'deleted', redirectTo: '/' }
    : previewOf(value) as AccountDeletionPreview & { status: 'pending' | 'error' };
}
