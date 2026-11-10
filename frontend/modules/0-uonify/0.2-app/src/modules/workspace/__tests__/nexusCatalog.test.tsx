import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { LiveNexus } from '../components/LiveNexus';
import { useGoogleOptions, useGooglePreferences } from '../hooks/googlePreferences';
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'owner@example.test', useSession: () => ({ user: { email: 'owner@example.test' } }) }));
afterEach(() => vi.restoreAllMocks());
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LiveNexus /></QueryClientProvider>);

it('filtra por búsqueda y conexión real, y Amazon sin configurar se solicita sin simular conexión', async () => {
  window.localStorage.clear();
  vi.spyOn(api, 'get').mockResolvedValue({ googleCloud: 'connected', drive: 'disconnected', projectReady: true });
  mount();
  await screen.findByText('Google Cloud');
  expect(screen.queryByText(/próximo|preparación/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Conectadas/ }));
  expect(screen.getByText('Google Cloud')).toBeInTheDocument();
  expect(screen.queryByText('Google Drive')).not.toBeInTheDocument();
  expect(screen.queryByText('WhatsApp Business')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'inexistente' } });
  expect(screen.getByText('No encontramos esa conexión')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ver todas las conexiones' }));
  fireEvent.click(screen.getByRole('button', { name: 'Activar Amazon Seller Central' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: /Conectar/ })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Solicitar activación de Amazon Seller Central' })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('muestra los 22 conectores por plataforma y registra la solicitud de activación', async () => {
  window.localStorage.clear();
  vi.spyOn(api, 'get').mockResolvedValue({ googleCloud: 'disconnected', drive: 'disconnected', projectReady: false });
  mount();
  await screen.findByText('Google Cloud');
  for (const platform of ['Meta', 'Microsoft', 'Google', 'OpenAI', 'AWS', 'Integraciones personalizadas']) expect(screen.getByRole('heading', { name: platform })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^Activar / })).toHaveLength(24);
  fireEvent.click(screen.getByRole('button', { name: 'Activar WhatsApp Business' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Qué podrá hacer Uony')).toBeInTheDocument();
  expect(within(dialog).getByText('Permisos que se solicitarán')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Solicitar activación de WhatsApp Business' }));
  expect(within(dialog).getByRole('status')).toHaveTextContent('Solicitud registrada. Activaremos esta conexión en tu espacio y te avisaremos.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
  expect(screen.getByText('Activación solicitada')).toBeInTheDocument();
  expect(screen.queryByText('Conectado')).not.toBeInTheDocument();
  expect(window.localStorage.getItem('uonify.nexus.requested')).toContain('meta-whatsapp');
});

it('abre la gestión real de Drive y exige confirmar para desconectar', async () => {
  let connected = true;
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/uony/services'
    ? { googleCloud: 'disconnected', drive: connected ? 'connected' : 'disconnected', projectReady: false } as never
    : { connection: { status: connected ? 'connected' : 'disconnected', email: 'owner@example.test' }, available: true, accessAllowed: true } as never);
  const remove = vi.spyOn(api, 'delete').mockImplementation(async () => { connected = false; return {} as never; });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Gestionar Google Drive' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Desconectar Google Drive' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mantener conexión' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Desconectar Google Drive' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar desconexión' }));
  expect(await within(dialog).findByRole('button', { name: 'Conectar Google Drive' })).toBeInTheDocument();
  expect(remove).toHaveBeenCalledWith('/connections/google-drive', { signal: expect.any(AbortSignal) });
});

it('actualiza los modelos del chat al revisar las conexiones sin recargar la página', async () => {
  let ready = false;
  useGooglePreferences.setState({ account: null, data: null, saving: false });
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/uony/options'
    ? { models: ready ? [{ id: 'gemini-3.5-flash', label: 'Flash disponible' }] : [], preferences: { model: 'auto', effort: 'medium' } } as never
    : { googleCloud: ready ? 'connected' : 'disconnected', drive: 'disconnected', projectReady: ready } as never);
  function ModelStatus() {
    const { data } = useGoogleOptions();
    return <output>{data?.models[0]?.label ?? 'Sin modelos'}</output>;
  }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LiveNexus /><ModelStatus /></QueryClientProvider>);
  await screen.findByText('Google Cloud');
  expect(screen.getByText('Sin modelos')).toBeInTheDocument();
  ready = true;
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar conexiones' }));
  expect(await screen.findByText('Flash disponible')).toBeInTheDocument();
});
