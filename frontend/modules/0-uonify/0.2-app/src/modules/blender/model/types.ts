export type BlenderOperation = 'inspect' | 'preview';
export type BlenderJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';

export interface BlenderScene { name: string; fileName: string; objectCount: number }
export interface BlenderUsage {
  calls: number;
  requestBytes: number;
  responseBytes: number;
  backendDurationMs: number;
  localDurationMs: number;
  storedPreviewBytes: number;
  estimatedCost: null;
}
export interface BlenderJob {
  id: string;
  productId: string | null;
  status: BlenderJobStatus;
  operation: 'inspect_scene' | 'render_preview';
  result: { scene?: BlenderScene } | null;
  error: string | { message?: string } | null;
  previewUrl: string | null;
}
export interface BlenderState {
  productId?: string | null;
  status: 'disconnected' | 'offline' | 'connected';
  deviceName: string | null;
  blenderVersion: string | null;
  lastSeenAt: string | null;
  scene: BlenderScene | null;
  capabilities: string[];
  accessAllowed: boolean;
  costPolicy: { execution: 'local'; billing: 'included_subscription'; extraCharge: 0 };
  usage?: BlenderUsage;
  lastJob?: BlenderJob | null;
  lastPreview?: BlenderJob | null;
}
export interface BlenderPair { deviceName: string; expiresAt: string }

export const blenderJobPending = (job?: BlenderJob | null) => job?.status === 'queued' || job?.status === 'running';

/** Solo se muestran imágenes privadas de este servicio, nunca URLs del dispositivo. */
export function blenderPreviewPath(url?: string | null): string | null {
  const prefix = '/api/connections/blender-local/previews/';
  if (!url?.startsWith(prefix)) return null;
  const id = url.slice(prefix.length);
  return /^[a-zA-Z0-9-]+$/.test(id) ? `/connections/blender-local/previews/${id}` : null;
}
