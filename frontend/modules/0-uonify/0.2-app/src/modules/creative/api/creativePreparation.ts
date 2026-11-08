import { api } from '@/shared/api/client';
import { creativePreparationOf, type CreativePreparation } from '../model/creativePreparation';

export async function getCreativePreparation(threadId: string, signal?: AbortSignal): Promise<CreativePreparation | null> {
  const response = await api.get<unknown>(
    `/uony/threads/${encodeURIComponent(threadId)}/creative-preparation`, { signal });
  const parsed = creativePreparationOf(response, threadId);
  if (parsed === undefined) throw new Error('La preparación creativa recibida no es válida.');
  return parsed;
}
