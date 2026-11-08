import { http } from 'msw';
import { PIM_ENDPOINTS } from '@/shared/pim';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { base64Size, deleteByKey, deleteByUpload, findObject, listByPrefix, MAX_UPLOAD_BYTES, signedUrlFor, storeUpload, type UploadBody } from './img3dStore';

/**
 * Simulación de los servicios 3D (Model3DService del original) bajo API_BASE:
 *   GET    /img-3d?prefix=output/<id>/   modelos listos (+ processing / progress)
 *   POST   /img-3d/download              URL firmada del GLB
 *   DELETE /img-3d?upload_id=…  | ?key=…
 *   POST   /img-3d/upload                subida en base64 (máx. 50 MB)
 * Éxito por defecto, con latencia realista y procesamiento simulado.
 */

/** Latencia de la subida: crece con el tamaño (0,8-3 s). */
const uploadLatency = (bytes: number) => Math.min(3000, 800 + Math.round((bytes / (1024 * 1024)) * 120));

export const handlers = [
  http.get(mock(PIM_ENDPOINTS.IMG_3D_LIST), async ({ request }) => {
    await latency(500);
    const prefix = new URL(request.url).searchParams.get('prefix') ?? '';
    if (!/^output\/[^/]+\/$/.test(prefix)) return fail(400, 'Indica la carpeta del modelo (output/<upload_id>/).', 'bad_request');
    return HttpResponse.json({ prefix, ...listByPrefix(prefix) });
  }),

  http.post(mock(PIM_ENDPOINTS.IMG_3D_DOWNLOAD), async ({ request }) => {
    await latency(250);
    const body = (await request.json().catch(() => null)) as { key?: unknown; expires?: unknown } | null;
    const key = typeof body?.key === 'string' ? body.key : '';
    if (!key) return fail(400, 'Falta la clave del modelo.', 'bad_request');
    if (!findObject(key)) return fail(404, 'No encontramos ese modelo 3D.', 'not_found');
    const expires = Number(body?.expires) > 0 ? Number(body?.expires) : 3600;
    return HttpResponse.json({ url: signedUrlFor(key), key, expires_in: expires });
  }),

  http.delete(mock(PIM_ENDPOINTS.IMG_3D_LIST), async ({ request }) => {
    await latency(400);
    const params = new URL(request.url).searchParams;
    const uploadId = params.get('upload_id');
    const key = params.get('key');
    if (uploadId) return HttpResponse.json({ deleted: deleteByUpload(uploadId), upload_id: uploadId });
    if (key) return HttpResponse.json({ deleted: deleteByKey(key) ? 1 : 0, key });
    return fail(400, 'Indica el modelo o la subida que quieres eliminar.', 'bad_request');
  }),

  http.post(mock(PIM_ENDPOINTS.IMG_3D_UPLOAD), async ({ request }) => {
    const body = (await request.json().catch(() => null)) as UploadBody | null;
    const image = typeof body?.image === 'string' ? body.image : '';
    const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';
    if (!image || !filename) {
      await latency(300);
      return fail(400, 'Falta el archivo del modelo.', 'bad_request');
    }
    const size = base64Size(image);
    await latency(uploadLatency(size));
    if (size > MAX_UPLOAD_BYTES) return fail(413, 'El archivo supera el máximo de 50 MB.', 'too_large');
    const stored = storeUpload({ ...body, image, filename });
    return HttpResponse.json({
      upload_id: stored.uploadId,
      s3_key: stored.key,
      url: signedUrlFor(stored.key),
      status: 'processing',
      ready_in_ms: stored.readyAt - stored.createdAt,
    });
  }),
];
