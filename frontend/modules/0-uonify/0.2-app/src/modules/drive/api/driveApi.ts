import { api } from '@/shared/api/client';
export interface DriveFile { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }
export interface DriveState { connection: { status: 'disconnected' | 'connected' | 'reauthorize' | 'account_mismatch'; email?: string; folderId?: string }; accessAllowed: boolean; preparationAllowed?: boolean; available: boolean; onboardingDeferred?: boolean }
export interface FilePage { files: DriveFile[]; nextPageToken?: string | null }
const base = '/connections/google-drive';
export const driveApi = {
  defer: () => api.post<{ onboardingDeferred: boolean }>(`${base}/defer`, {}),
  state: () => api.get<DriveState>(base),
  files: (parent: string, search: string, page?: string) => api.get<FilePage>(`${base}/files`, { params: { parent, search, page }, signal: AbortSignal.timeout(30_000) }),
  materials: () => api.get<{ files: DriveFile[] }>(`${base}/materials`),
  select: (fileId: string) => api.post(`${base}/materials`, { fileId }),
  remove: (fileId: string) => api.delete(`${base}/materials/${encodeURIComponent(fileId)}`),
  disconnect: (signal?: AbortSignal) => api.delete(base, { signal }),
  upload: (file: File, requestId: string) => api.post(`${base}/upload`, file, { params: { name: file.name, requestId }, headers: { 'Content-Type': file.type || 'application/octet-stream' }, signal: AbortSignal.timeout(90_000) }),
};
