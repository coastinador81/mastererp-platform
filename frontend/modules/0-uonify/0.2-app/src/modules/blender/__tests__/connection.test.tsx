import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { BlenderConnectionSettings } from '../components/BlenderConnectionSettings';
import type { BlenderState } from '../model/types';

vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'owner@example.test' }));

const base = '/connections/blender-local';
const account = 'owner@example.test';
const pairId = '0911a530-d057-4016-ab75-bd9aab36fcd2';
function state(status: BlenderState['status'] = 'connected'): BlenderState {
  return { status, deviceName: 'Mac del dueño', blenderVersion: '5.0.1', lastSeenAt: new Date().toISOString(), scene: null, capabilities: ['inspect_scene', 'render_preview'], accessAllowed: true, costPolicy: { execution: 'local', billing: 'included_subscription', extraCharge: 0 } };
}
function mount(props: { pairId?: string; onPairHandled?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><BlenderConnectionSettings account={account} {...props} /></QueryClientProvider>);
}
function pairReads(data = state('disconnected'), expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === base) return data as never;
    if (path === `${base}/pair/${pairId}`) return { deviceName: 'Mac solicitante', expiresAt } as never;
    throw new Error(`Ruta inesperada: ${path}`);
  });
}
beforeEach(() => { vi.spyOn(api, 'post').mockResolvedValue({}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('muestra un fallo real sin conexión ni acciones simuladas de respaldo', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, {}));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('No podemos comprobar Blender.');
  expect(screen.queryByText('Conectado')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Preparar vista previa' })).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

it('sin un equipo vinculado indica cómo abrir el conector y no inventa un botón de conexión', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(state('disconnected'));
  mount();
  expect(await screen.findByText('Sin conectar')).toBeInTheDocument();
  expect(screen.getByText(/Abre el conector local de Uonify en tu Mac/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Conectar este equipo/ })).not.toBeInTheDocument();
  expect(screen.getByText(/Incluido en tu suscripción/)).toBeInTheDocument();
});

it('muestra el equipo solicitado y solo lo vincula al aprobar, consultando el estado persistido', async () => {
  let data = state('disconnected');
  vi.spyOn(api, 'get').mockImplementation(async path => path === base ? data as never : { deviceName: 'Mac solicitante', expiresAt: new Date(Date.now() + 60_000).toISOString() } as never);
  const handled = vi.fn();
  vi.mocked(api.post).mockImplementation(async () => { data = state(); return data as never; });
  mount({ pairId, onPairHandled: handled });
  await screen.findByText('Mac solicitante');
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Conectar este equipo' }));
  expect(await screen.findByText('Conectado')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith(`${base}/connect`, { pairId }, expect.any(Object));
  expect(handled).toHaveBeenCalledOnce();
});

it('conserva la solicitud cuando el servidor rechaza la conexión', async () => {
  pairReads(); const handled = vi.fn();
  vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Este equipo ya está vinculado.' }));
  mount({ pairId, onPairHandled: handled });
  fireEvent.click(await screen.findByRole('button', { name: 'Conectar este equipo' }));
  expect(await screen.findByText('Este equipo ya está vinculado.')).toBeInTheDocument();
  expect(handled).not.toHaveBeenCalled();
  expect(screen.getByText('Sin conectar')).toBeInTheDocument();
});

it('no permite aprobar una solicitud caducada', async () => {
  pairReads(state('disconnected'), new Date(Date.now() - 1000).toISOString());
  mount({ pairId });
  expect(await screen.findByRole('alert')).toHaveTextContent('La solicitud ha caducado.');
  expect(screen.queryByRole('button', { name: 'Conectar este equipo' })).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

it('bloquea la aprobación y las operaciones sin acceso vigente a Uonify', async () => {
  pairReads({ ...state('disconnected'), accessAllowed: false });
  mount({ pairId });
  expect(await screen.findByRole('button', { name: 'Conectar este equipo' })).toBeDisabled();
  expect(screen.getByText(/Necesitas una prueba o suscripción vigente/)).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

it('requiere confirmar la desconexión y recupera su resultado real', async () => {
  let data = state();
  vi.spyOn(api, 'get').mockImplementation(async () => data as never);
  vi.mocked(api.post).mockImplementation(async () => { data = state('disconnected'); return data as never; });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Desconectar Blender' }));
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Mantener conexión' }));
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Desconectar Blender' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar desconexión' }));
  expect(await screen.findByText('Sin conectar')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith(`${base}/disconnect`, {}, expect.any(Object));
});

it('Nexus conserva permisos y uso sin lanzar trabajos ni presentar renders de producto', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...state(), lastJob: { id: 'previous', status: 'completed', operation: 'render_preview', previewUrl: '/api/connections/blender-local/previews/previous' } });
  mount();
  await screen.findByText('Conectado');
  expect(screen.getByText(/Puedes pedir a Uony que consulte la escena o prepare una vista previa/)).toBeInTheDocument();
  expect(screen.getByText(/También puedes abrir la pestaña 3D de Producto cuando quieras/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Consultar escena' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Preparar vista previa' })).not.toBeInTheDocument();
  expect(screen.queryByAltText('Vista previa de la escena de Blender')).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});
