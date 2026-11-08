import { api, errorMessage } from '@/shared/api/client';
import { readFileAsDataURL } from '@/shared/lib';
import { PIM_ENDPOINTS } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { SIGNED_URL_EXPIRES, UPLOAD_TIMEOUT } from '../model/constants';
import { timeoutSignal } from '../model/format';
import { trackBlobURL } from '../model/pageState';
import type { Model3DFile, Model3DMetadata } from '../model/types';

/**
 * Model3DService del original (services/pim/model3DService.ts). Contrato con el
 * backend (rutas bajo API_BASE):
 *   GET    /img-3d?prefix=output/<uploadId>/     → { items: [{ key, size, metadata }] }
 *   POST   /img-3d/download { key, expires }     → { url } (URL firmada del GLB)
 *   DELETE /img-3d?upload_id=<uploadId>          → borra todos los modelos de la subida
 *   DELETE /img-3d?key=<key>                     → borra un modelo
 *   POST   /img-3d/upload { image (base64), filename, content_type, folder: 'output', upload_id? }
 *                                                → { upload_id, s3_key, url }
 */

interface ListItem {
  key: string;
  size: number;
  metadata?: Model3DMetadata;
}
interface ListResponse {
  items?: ListItem[];
  files?: ListItem[];
}
interface DownloadResponse {
  url?: string;
  download_url?: string;
}
interface UploadResponse {
  upload_id?: string;
  s3_key?: string;
  url?: string;
}

export interface UploadResult {
  upload_id?: string;
  s3_key?: string;
  url?: string;
  filename: string;
  size: number;
}

/** Descarga del GLB desde la URL firmada (sin credenciales, como axios en el original). */
async function fetchSignedFile(url: string): Promise<Blob> {
  const response = await fetch(url, { headers: { Accept: 'model/gltf-binary,application/octet-stream,*/*' }, credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

/** Contenido del archivo en base64 (sin el prefijo data:). */
export async function fileToBase64Direct(file: Blob): Promise<string> {
  const result = await readFileAsDataURL(file);
  return String(result).split(',')[1] ?? '';
}

export const Model3DService = {
  /** Modelos generados de una subida; lista vacía en silencio si falla (como el original). */
  async listModelsByUploadId(uploadId: string): Promise<Model3DFile[]> {
    try {
      const data = await api.get<ListResponse | null>(PIM_ENDPOINTS.IMG_3D_LIST, { params: { prefix: `output/${uploadId}/` } });
      const items = data?.items || data?.files || [];
      return await Promise.all(items.map(async item => ({
        key: item.key,
        url: await Model3DService.getSignedUrl(item.key),
        size: item.size,
        type: 'model/gltf-binary',
        metadata: item.metadata,
      })));
    } catch {
      return [];
    }
  },

  /** URL firmada → GLB → blob: URL local (cadena vacía si falla). */
  async getSignedUrl(key: string): Promise<string> {
    try {
      const data = await api.post<DownloadResponse | null>(PIM_ENDPOINTS.IMG_3D_DOWNLOAD, { key, expires: SIGNED_URL_EXPIRES });
      const signed = data?.url || data?.download_url;
      if (!signed) throw new Error('No URL returned');
      const blob = await fetchSignedFile(signed);
      return trackBlobURL(URL.createObjectURL(blob));
    } catch {
      return '';
    }
  },

  async deleteAllModels(uploadId: string): Promise<void> {
    await api.delete(PIM_ENDPOINTS.IMG_3D_LIST, { params: { upload_id: uploadId } });
  },

  async upload3DModel(file: File, uploadId?: string): Promise<UploadResult> {
    toast.info('Subiendo modelo 3D...');
    try {
      const image = await fileToBase64Direct(file);
      const body: Record<string, string> = { image, filename: file.name, content_type: file.type || 'model/gltf-binary', folder: 'output' };
      if (uploadId) body.upload_id = uploadId;
      const data = await api.post<UploadResponse | null>(PIM_ENDPOINTS.IMG_3D_UPLOAD, body, { signal: timeoutSignal(UPLOAD_TIMEOUT) });
      toast.success('Modelo 3D subido correctamente');
      return { upload_id: data?.upload_id, s3_key: data?.s3_key, url: data?.url, filename: file.name, size: file.size };
    } catch (error) {
      const message = errorMessage(error, 'Error al subir modelo 3D');
      toast.error(message);
      throw new Error(message, { cause: error });
    }
  },

  async deleteModel(key: string): Promise<void> {
    await api.delete(PIM_ENDPOINTS.IMG_3D_LIST, { params: { key } });
  },
};
