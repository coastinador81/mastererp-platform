import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { LiveNexus } from '../components/LiveNexus';
import { entryRedirect } from '../model/entry';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'owner@example.test' }));
const base = '/connections/blender-local';
const pairId = '0911a530-d057-4016-ab75-bd9aab36fcd2';
const state = (connected = false) => ({ status: connected ? 'connected' : 'disconnected', deviceName: 'Mac del dueño', blenderVersion: '5.0.1', lastSeenAt: null, scene: null, capabilities: ['inspect_scene', 'render_preview'], accessAllowed: true, costPolicy: { execution: 'local', billing: 'included_subscription', extraCharge: 0 } });
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><LiveNexus /></QueryClientProvider>);
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

it('conserva la entrada de Nexus que envía el conector local', () => {
  expect(entryRedirect('/espacio/nexus', `?blenderPair=${pairId}`)).toBeNull();
  expect(entryRedirect('/espacio/nexus', '')).toBe('/espacio');
  expect(entryRedirect('/espacio/producto', `?blenderPair=${pairId}`)).toBe('/espacio');
});

it('Blender participa en búsqueda y filtro solo con el estado real de la conexión', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path === base ? state(true) as never : { googleCloud: 'disconnected', drive: 'disconnected' } as never);
  mount();
  await screen.findByRole('button', { name: 'Gestionar Blender' });
  fireEvent.click(screen.getByRole('button', { name: /Conectadas/ }));
  expect(screen.getByText('Blender')).toBeInTheDocument();
  expect(screen.queryByText('Google Drive')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'diseño' } });
  expect(screen.getByText('Blender')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar Blender' }));
  expect(await within(screen.getByRole('dialog')).findByText('Mac del dueño')).toBeInTheDocument();
});

it('abre la aprobación al llegar desde Blender y elimina solo el parámetro de emparejamiento tras éxito', async () => {
  window.history.replaceState({}, '', `/espacio/nexus?blenderPair=${pairId}&origen=local`);
  let connected = false;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === base) return state(connected) as never;
    if (path === `${base}/pair/${pairId}`) return { deviceName: 'Equipo solicitado', expiresAt: new Date(Date.now() + 60_000).toISOString() } as never;
    return { googleCloud: 'disconnected', drive: 'disconnected' } as never;
  });
  vi.spyOn(api, 'post').mockImplementation(async () => { connected = true; return state(true) as never; });
  mount();
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('Equipo solicitado')).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Conectar este equipo' }));
  await waitFor(() => expect(window.location.search).toBe('?origen=local'));
  expect(await within(dialog).findByRole('button', { name: 'Desconectar Blender' })).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledOnce();
});
