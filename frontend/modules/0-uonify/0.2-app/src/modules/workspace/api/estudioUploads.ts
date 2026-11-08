import { ApiError, api } from '@/shared/api/client';

/**
 * Contrato de SUBIDA de imagen del Estudio — ESTABLE, confirmado por Super Computer (27-10, backend sha 2e59674).
 * El cliente sube UNA foto por multipart; el backend la guarda en el Google Cloud del PROPIO cliente (PATH A),
 * crea el recibo de propiedad y devuelve un **assetId OPACO** (un uuid). El frontend solo maneja `assetId` y lo
 * pasa a generar/cotizar; NUNCA ve gs://, generación ni hash (card-safe, D-PROTECCIÓN).
 *
 * AUTH: por SESIÓN (cookie HttpOnly; `credentials: 'include'` del cliente) + CSRF por Origin (fetch del mismo
 * origen → el navegador manda Origin; el backend hace require_origin). `thread_id` va en la ruta, nunca en el cuerpo.
 *
 * INERTE: la ruta NO está montada aún (sin include_router hasta OK Consultor + REA + dueño); el contrato no cambia.
 */

/** Formatos aceptados (el backend los valida por el Content-Type del part; webp NO está). */
export const ESTUDIO_UPLOAD_ACCEPT = 'image/jpeg,image/png';
/** Tamaño máximo (el backend rechaza >10 MB con 413); el mínimo es 1 byte. El backend NO valida dimensiones. */
export const ESTUDIO_UPLOAD_MAX_MB = 10;

/** Respuesta 200 de la subida: la referencia OPACA + metadatos mínimos. */
export interface EstudioUploadAsset {
  /** uuid opaco; se pasa a generar/cotizar. El backend resuelve el recibo (gs://, generation, sha256). */
  assetId: string;
  mimeType: 'image/jpeg' | 'image/png';
  byteSize: number;
}

function estudioUploadPath(threadId: string): string {
  return `/uony/threads/${encodeURIComponent(threadId)}/estudio/uploads`;
}

/**
 * Sube la foto del producto al Estudio (multipart/form-data, campo `file`) y devuelve el assetId opaco.
 * Errores del backend (body {error, message} card-safe): 413 upload_too_large, 400 upload_rejected,
 * 409 cloud_not_ready (el cliente debe conectar su Google Cloud), 503 upload_unavailable. INERTE hasta cablear;
 * falla cerrado si el backend no devuelve una referencia válida (no se sigue a generar con algo a medias).
 */
export async function uploadEstudioImage(threadId: string, file: File, signal?: AbortSignal): Promise<EstudioUploadAsset> {
  const body = new FormData();
  body.append('file', file);
  const asset = await api.post<EstudioUploadAsset>(estudioUploadPath(threadId), body, { signal });
  if (!asset || typeof asset.assetId !== 'string' || !asset.assetId) {
    throw new ApiError(502, asset, 'El Estudio no devolvió una referencia válida de la foto. Inténtalo de nuevo.');
  }
  return asset;
}

/** Código de error del backend (para afinar la UI, p. ej. 409 `cloud_not_ready` → conectar Google Cloud). */
export function estudioUploadErrorCode(error: unknown): string | null {
  if (error instanceof ApiError) {
    const data = error.data as { error?: unknown } | null;
    if (data && typeof data.error === 'string') return data.error;
  }
  return null;
}
