import { api } from '@/shared/api/client';

export type InstructionDriveJobStatus = 'queued' | 'running' | 'ready' | 'paused' | 'error';
export interface InstructionDriveJob {
  id: string;
  status: InstructionDriveJobStatus;
  folderName: string;
  processed: number;
  total: number;
  observations: { source: string; summary: string }[];
  additionalObservations: number;
}

const statuses = new Set<InstructionDriveJobStatus>(['queued', 'running', 'ready', 'paused', 'error']);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** La lectura es solo del trabajo ya guardado; nunca inicia otra ejecución. */
export async function getInstructionDriveJob(jobId: string, intakeId: string | null,
  signal?: AbortSignal): Promise<InstructionDriveJob> {
  const response: unknown = await api.get(`/uony/materials/jobs/${encodeURIComponent(jobId)}`, { signal });
  if (!record(response) || !record(response.job)) throw new Error('No se ha podido consultar el análisis guardado.');
  const { job } = response;
  if (job.id !== jobId || response.intakeId !== intakeId || (job.intakeId ?? null) !== intakeId
    || typeof job.status !== 'string' || !statuses.has(job.status as InstructionDriveJobStatus)
    || typeof job.folderName !== 'string' || job.folderName.length > 255
    || !Number.isSafeInteger(job.processed) || (job.processed as number) < 0
    || !Number.isSafeInteger(job.total) || (job.total as number) < 0) {
    throw new Error('El estado del análisis guardado no corresponde a esta conversación.');
  }
  const sources = Array.isArray(job.sources) ? job.sources : [];
  const observations = sources.filter(source => record(source)
    && typeof source.name === 'string' && typeof source.summary === 'string'
    && source.name.trim() && source.summary.trim());
  return { id: job.id as string, status: job.status as InstructionDriveJobStatus,
    folderName: job.folderName, processed: job.processed as number, total: job.total as number,
    observations: observations.slice(0, 3).map(source => ({
      source: String(source.name).trim().slice(0, 80),
      summary: String(source.summary).trim().slice(0, 240),
    })),
    additionalObservations: Math.max(0, observations.length - 3) };
}
