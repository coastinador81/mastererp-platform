import { collection } from '@/shared/mocks/db';
import { sampleFor } from './fixtures/sampleModels';

/**
 * «Almacén S3» de la simulación de /img-3d. Guarda en la sesión los metadatos
 * de cada objeto; los bytes subidos solo viven en memoria (un GLB no cabe en
 * sessionStorage): tras recargar, la descarga sirve un modelo de ejemplo.
 * Cada subida pasa por un procesamiento simulado (validación y optimización)
 * antes de aparecer en output/<upload_id>/.
 */
export interface StoredModel {
  id: string;
  key: string;
  uploadId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: number;
  readyAt: number;
  metadata: {
    polygons: number;
    texture_resolution: string;
    format: string;
    compression: string;
    file_size: number;
  };
}

/** Procesamiento simulado de una subida hasta que aparece en la lista. */
export const PROCESSING_MS = 6000;
/** Generación simulada de un modelo a partir de imágenes subidas (carpeta distinta de output). */
export const GENERATION_MS = 20000;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const objects = collection<StoredModel>('img-3d-objects');
const bytes = new Map<string, Blob>();
const signed = new Map<string, string>();

export interface UploadBody {
  image?: unknown;
  filename?: unknown;
  content_type?: unknown;
  folder?: unknown;
  upload_id?: unknown;
}

/** Bytes que ocupa un base64 (sin decodificarlo). */
export function base64Size(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function decodeBase64(value: string, type: string): Blob | null {
  try {
    const binary = atob(value);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
    return new Blob([data], { type });
  } catch {
    return null;
  }
}

const newUploadId = () => `upl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const safeName = (name: string) => name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'modelo.glb';

/** Guarda una subida. Devuelve el objeto creado. */
export function storeUpload(body: Required<Pick<UploadBody, 'image' | 'filename'>> & UploadBody, now = Date.now()): StoredModel {
  const image = String(body.image);
  const filename = safeName(String(body.filename));
  const contentType = typeof body.content_type === 'string' && body.content_type ? body.content_type : 'model/gltf-binary';
  const folder = typeof body.folder === 'string' && body.folder ? body.folder : 'output';
  const uploadId = typeof body.upload_id === 'string' && body.upload_id ? body.upload_id : newUploadId();
  const key = `${folder}/${uploadId}/${filename}`;
  const size = base64Size(image);
  const blob = decodeBase64(image, contentType);
  if (blob) bytes.set(key, blob);
  signed.delete(key);
  const stored: StoredModel = {
    id: key,
    key,
    uploadId,
    filename,
    contentType,
    size,
    createdAt: now,
    readyAt: now + PROCESSING_MS,
    metadata: {
      // Estimación del análisis: ~180 bytes por triángulo en un GLB sin comprimir.
      polygons: Math.max(1000, Math.min(200000, Math.round(size / 180))),
      texture_resolution: '2048x2048',
      format: filename.toLowerCase().endsWith('.gltf') ? 'glTF' : 'GLB',
      compression: 'Sin compresión',
      file_size: size,
    },
  };
  objects.upsert(stored);
  // Imágenes fuente (folder 'input'…): el servidor genera un GLB en output/<upload_id>/.
  if (folder !== 'output') storeGenerated(uploadId, now);
  return stored;
}

/** Resultado de una generación con IA: un modelo de ejemplo de /assets tras GENERATION_MS. */
function storeGenerated(uploadId: string, now: number): void {
  const key = `output/${uploadId}/modelo-generado.glb`;
  if (objects.get(key)) return;
  const sample = sampleFor(key);
  objects.upsert({
    id: key,
    key,
    uploadId,
    filename: 'modelo-generado.glb',
    contentType: 'model/gltf-binary',
    size: sample.size,
    createdAt: now,
    readyAt: now + GENERATION_MS,
    metadata: { polygons: sample.polygons, texture_resolution: sample.texture, format: 'GLB', compression: 'Sin compresión', file_size: sample.size },
  });
}

export interface ListResult {
  items: { key: string; size: number; last_modified: string; metadata: StoredModel['metadata'] }[];
  /** Objetos de la carpeta que aún se están procesando. */
  processing: number;
  /** Progreso medio del procesamiento de la carpeta (100 si no queda nada). */
  progress: number;
}

/** Objetos listos bajo un prefijo (output/<upload_id>/). */
export function listByPrefix(prefix: string, now = Date.now()): ListResult {
  const matching = objects.all().filter(item => item.key.startsWith(prefix));
  const ready = matching.filter(item => item.readyAt <= now);
  const pending = matching.filter(item => item.readyAt > now);
  const progress = pending.length
    ? Math.round(pending.reduce((sum, item) => sum + Math.min(1, (now - item.createdAt) / (item.readyAt - item.createdAt)), 0) / pending.length * 100)
    : 100;
  return {
    items: ready.map(item => ({ key: item.key, size: item.size, last_modified: new Date(item.readyAt).toISOString(), metadata: item.metadata })),
    processing: pending.length,
    progress,
  };
}

export const findObject = (key: string): StoredModel | undefined => objects.get(key);

/**
 * URL «firmada» del objeto: la de sus bytes en memoria o, si ya no están
 * (recarga), la de un modelo de ejemplo de /assets.
 */
export function signedUrlFor(key: string): string {
  const cached = signed.get(key);
  if (cached) return cached;
  const blob = bytes.get(key);
  if (blob) {
    try {
      const url = URL.createObjectURL(blob);
      signed.set(key, url);
      return url;
    } catch {
      /* entorno sin blob: URLs: modelo de ejemplo */
    }
  }
  return sampleFor(key).url;
}

function forget(key: string): void {
  bytes.delete(key);
  const url = signed.get(key);
  try {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  } catch {
    /* entorno sin blob: URLs */
  }
  signed.delete(key);
}

export function deleteByKey(key: string): boolean {
  forget(key);
  return objects.remove(key);
}

export function deleteByUpload(uploadId: string): number {
  const matching = objects.all().filter(item => item.uploadId === uploadId);
  matching.forEach(item => { forget(item.key); objects.remove(item.id); });
  return matching.length;
}

/** Vacía la simulación (pruebas). */
export function resetImg3dStore(): void {
  objects.all().forEach(item => forget(item.key));
  objects.reset();
}
