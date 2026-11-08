import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { api } from '@/shared/api/client';
import { BlenderProductWorkspace } from '../components/BlenderProductWorkspace';
import { blenderPreviewPath, type BlenderJob, type BlenderState } from '../model/types';

const base = '/connections/blender-local';
const account = 'owner@example.test';
const productId = '458ad58c-345b-4d8f-bb62-2fe202f3b8e0';
const otherId = 'd2b1e86d-9d50-4bdf-9027-55bfa8fcf136';
const jobId = '171cb1a3-9b6b-4722-9dab-a4c0d7c5f143';
const scene = { name: 'Torre compacta', fileName: 'propuesta.blend', objectCount: 54 };
function state(status: BlenderState['status'] = 'connected'): BlenderState {
  return { status, deviceName: 'Mac del dueño', blenderVersion: '5.0.1', lastSeenAt: new Date().toISOString(), scene: null, capabilities: ['inspect_scene', 'render_preview'], accessAllowed: true, costPolicy: { execution: 'local', billing: 'included_subscription', extraCharge: 0 } };
}
function job(status: BlenderJob['status'] = 'completed', operation: BlenderJob['operation'] = 'inspect_scene'): BlenderJob {
  return { id: jobId, productId, status, operation, result: status === 'completed' ? { scene } : null, error: null, previewUrl: null };
}
function mount(id = productId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><BlenderProductWorkspace key={id} account={account} productId={id} /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.spyOn(api, 'post').mockResolvedValue({}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('consulta una escena real a través de un trabajo y no vuelve a ejecutar al recibir el resultado', async () => {
  let active: BlenderJob | null = null;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === base) return { ...state(), lastJob: active } as never;
    active = job(); return { job: active } as never;
  });
  vi.mocked(api.post).mockImplementation(async () => { active = job('queued'); return { job: active } as never; });
  mount();
  await screen.findByText('Conectado');
  fireEvent.click(await screen.findByRole('button', { name: 'Consultar escena' }));
  expect(await screen.findByText('Torre compacta')).toBeInTheDocument();
  expect(screen.getByText('54')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledOnce();
  expect(api.post).toHaveBeenCalledWith(`${base}/inspect`, { requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), productId }, expect.any(Object));
  expect(api.get).toHaveBeenCalledWith(base, expect.objectContaining({ params: { productId } }));
  expect(api.get).toHaveBeenCalledWith(`${base}/jobs/${jobId}`, expect.any(Object));
});

it('si se pierde la respuesta reutiliza el UUID al volver a solicitar la misma operación', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(state());
  vi.mocked(api.post).mockRejectedValue(new TypeError('Network error'));
  mount();
  await screen.findByText('Conectado');
  fireEvent.click(await screen.findByRole('button', { name: 'Consultar escena' }));
  await screen.findByText('Sin conexión. Revisa tu red e inténtalo de nuevo.');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Consultar escena' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Consultar escena' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(vi.mocked(api.post).mock.calls[1][1]);
});

it('recupera una tarea activa al reabrir el panel y bloquea otra operación', async () => {
  const active = job('running');
  vi.spyOn(api, 'get').mockImplementation(async path => path === base ? { ...state(), lastJob: active } as never : { job: active } as never);
  mount();
  expect(await screen.findByText('Consultando la escena en Blender…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preparar vista previa' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Consultar escena' })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
});

it('muestra un resultado incierto sin repetir automáticamente el trabajo', async () => {
  const uncertain = job('unknown');
  vi.spyOn(api, 'get').mockImplementation(async path => path === base ? { ...state('offline'), lastJob: uncertain } as never : { job: uncertain } as never);
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('no podemos confirmar el resultado');
  expect(screen.getByText('Equipo sin conexión')).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

it('solo acepta vistas previas del endpoint privado de Blender', () => {
  expect(blenderPreviewPath(`/api${base}/previews/${jobId}`)).toBe(`${base}/previews/${jobId}`);
  expect(blenderPreviewPath('https://example.test/image.png')).toBeNull();
  expect(blenderPreviewPath(`/api${base}/previews/../../secret`)).toBeNull();
  expect(blenderPreviewPath(`/api${base}/previews/${jobId}?token=secret`)).toBeNull();
});

it('conserva el PNG del producto tras otra consulta y libera la imagen al cerrar', async () => {
  const create = vi.fn(() => 'blob:preview-test');
  const revoke = vi.fn();
  class PreviewUrl extends URL { static createObjectURL = create; static revokeObjectURL = revoke; }
  vi.stubGlobal('URL', PreviewUrl);
  const completed = { ...job('completed', 'render_preview'), previewUrl: `/api${base}/previews/${jobId}` };
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === base) return { ...state(), lastJob: job(), lastPreview: completed } as never;
    if (path === `${base}/previews/${jobId}`) return new Blob(['png'], { type: 'image/png' }) as never;
    return { job: job() } as never;
  });
  const view = mount();
  expect(await screen.findByAltText('Vista previa de la escena de Blender')).toHaveAttribute('src', 'blob:preview-test');
  expect(api.get).toHaveBeenCalledWith(`${base}/previews/${jobId}`, { responseType: 'blob' });
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:preview-test');
});

it.each([null, otherId])('no atribuye a este producto un trabajo cuyo ámbito es %s', async scope => {
  const foreign = { ...job('completed', 'render_preview'), productId: scope, result: { scene: { ...scene, name: 'Escena ajena' } }, previewUrl: `/api${base}/previews/${jobId}` };
  vi.spyOn(api, 'get').mockResolvedValue({ ...state(), lastJob: foreign, lastPreview: foreign });
  mount();
  await screen.findByText('Conectado');
  expect(screen.queryByText('Escena ajena')).not.toBeInTheDocument();
  expect(screen.queryByAltText('Vista previa de la escena de Blender')).not.toBeInTheDocument();
  expect(screen.getByText('Tu vista previa aparecerá aquí')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(1);
});

it('rechaza una tarea devuelta con otro producto y no la presenta como resultado propio', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(state());
  vi.mocked(api.post).mockResolvedValue({ job: { ...job(), productId: otherId } });
  mount();
  await screen.findByText('Conectado');
  fireEvent.click(await screen.findByRole('button', { name: 'Consultar escena' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('La tarea no corresponde a este producto.');
  expect(screen.queryByText('Torre compacta')).not.toBeInTheDocument();
});

it('ofrece Nexus y bloquea tareas mientras el equipo está sin conexión', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(state('offline'));
  mount();
  await screen.findByText('Equipo sin conexión');
  expect(screen.getByRole('link', { name: 'Gestionar en Nexus' })).toHaveAttribute('href', '/espacio/nexus');
  expect(screen.getByRole('button', { name: 'Consultar escena' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Preparar vista previa' })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
});
