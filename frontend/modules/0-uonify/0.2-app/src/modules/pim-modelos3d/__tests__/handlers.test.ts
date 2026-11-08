import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { api } from '@/shared/api/client';
import { toast } from '@/shared/ui';
import { Model3DService } from '../api/model3dService';
import { handlers } from '../mocks/handlers';
import { GENERATION_MS, PROCESSING_MS, resetImg3dStore } from '../mocks/img3dStore';

vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

// Los GLB de /assets los sirve Vite; aquí, un binario pequeño.
const server = setupServer(...handlers, http.get('/assets/*', () => HttpResponse.arrayBuffer(new Uint8Array([103, 108, 84, 70]).buffer)));
const upload = (body: Record<string, string>) => api.post<{ upload_id: string; s3_key: string; status: string }>('/img-3d/upload', body);
const list = (uploadId: string) => api.get<{ items: { key: string; size: number; metadata: Record<string, unknown> }[]; processing: number; progress: number }>(
  '/img-3d',
  { params: { prefix: `output/${uploadId}/` } },
);

let now = 1_700_000_000_000;
const originalCreateObjectURL = URL.createObjectURL;
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetImg3dStore();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
  server.resetHandlers();
  Object.assign(URL, { createObjectURL: originalCreateObjectURL });
});

describe('simulación de /img-3d', () => {
  test('subida → procesamiento → lista con metadatos → descarga → borrado', async () => {
    const uploaded = await upload({ image: btoa('glTF-binario'), filename: 'torre 25 piezas.glb', content_type: 'model/gltf-binary', folder: 'output' });
    expect(uploaded.upload_id).toMatch(/^upl_/);
    expect(uploaded.s3_key).toBe(`output/${uploaded.upload_id}/torre-25-piezas.glb`);
    expect(uploaded.status).toBe('processing');

    const pending = await list(uploaded.upload_id);
    expect(pending.items).toEqual([]);
    expect(pending.processing).toBe(1);

    now += PROCESSING_MS / 2;
    expect((await list(uploaded.upload_id)).progress).toBe(50);
    now += PROCESSING_MS;
    const ready = await list(uploaded.upload_id);
    expect(ready.processing).toBe(0);
    expect(ready.items).toHaveLength(1);
    expect(ready.items[0]).toMatchObject({ key: uploaded.s3_key, size: 12, metadata: { format: 'GLB', compression: 'Sin compresión', file_size: 12 } });

    const signed = await api.post<{ url: string; expires_in: number }>('/img-3d/download', { key: uploaded.s3_key, expires: 3600 });
    expect(signed.url).toBeTruthy();
    expect(signed.expires_in).toBe(3600);

    await api.delete('/img-3d', { params: { key: uploaded.s3_key } });
    expect((await list(uploaded.upload_id)).items).toEqual([]);
  });

  test('imágenes fuente: el servidor genera un GLB de ejemplo', async () => {
    const { upload_id: uploadId } = await upload({ image: btoa('jpeg'), filename: 'foto.jpg', content_type: 'image/jpeg', folder: 'input' });
    expect((await list(uploadId)).items).toEqual([]);
    now += GENERATION_MS;
    const { items } = await list(uploadId);
    expect(items.map(item => item.key)).toEqual([`output/${uploadId}/modelo-generado.glb`]);
    expect(items[0].metadata).toMatchObject({ format: 'GLB' });
    // Sin bytes propios, la URL firmada es uno de los GLB de ejemplo de /assets.
    const signed = await api.post<{ url: string }>('/img-3d/download', { key: items[0].key, expires: 3600 });
    expect(signed.url).toMatch(/^\/assets\/.+\.glb$/);
    await api.delete('/img-3d', { params: { upload_id: uploadId } });
    expect((await list(uploadId)).items).toEqual([]);
  });

  test('errores con el formato del backend', async () => {
    await expect(api.post('/img-3d/upload', { filename: 'x.glb' })).rejects.toMatchObject({ status: 400 });
    await expect(api.get('/img-3d', { params: { prefix: 'otra/cosa' } })).rejects.toMatchObject({ status: 400 });
    await expect(api.post('/img-3d/download', { key: 'output/nada/x.glb' })).rejects.toMatchObject({ status: 404 });
    await expect(api.delete('/img-3d')).rejects.toMatchObject({ status: 400 });
  });
});

describe('Model3DService contra la simulación', () => {
  test('sube el archivo y lista los modelos con su URL local', async () => {
    // jsdom no crea blob: URLs: la simulación y el servicio reciben una ruta de /assets.
    Object.assign(URL, { createObjectURL: vi.fn(() => '/assets/caja-local.glb') });
    const info = vi.spyOn(toast, 'info');
    const success = vi.spyOn(toast, 'success');
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'caja.glb', { type: 'model/gltf-binary' });
    const result = await Model3DService.upload3DModel(file);
    expect(info).toHaveBeenCalledWith('Subiendo modelo 3D...');
    expect(success).toHaveBeenCalledWith('Modelo 3D subido correctamente');
    expect(result).toMatchObject({ filename: 'caja.glb', size: 4 });
    expect(result.upload_id).toBeTruthy();

    now += PROCESSING_MS;
    const files = await Model3DService.listModelsByUploadId(result.upload_id as string);
    expect(files).toEqual([
      expect.objectContaining({ key: `output/${result.upload_id}/caja.glb`, url: '/assets/caja-local.glb', size: 4, type: 'model/gltf-binary' }),
    ]);
  });

  test('una lista que falla queda vacía, en silencio', async () => {
    server.use(http.get('/api/img-3d', () => HttpResponse.json({ message: 'Caído' }, { status: 500 })));
    expect(await Model3DService.listModelsByUploadId('upl_x')).toEqual([]);
  });
});
