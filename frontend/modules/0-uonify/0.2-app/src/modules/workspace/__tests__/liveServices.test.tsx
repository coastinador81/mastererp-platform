import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { ServicesMenu } from '../components/ServicesMenu';
import { LiveNexus } from '../components/LiveNexus';
import { LiveServiceView } from '../components/LiveServiceView';
import { LiveServices } from '../components/LiveServices';
import { setUi, workspaceRefs } from '../hooks/uiStore';
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', async original => ({ ...await original<typeof import('@/modules/auth')>(),
  currentAccountEmail: () => 'owner@example.test',
  useAccountSummary: () => ({ initial: 'O', name: 'Owner', email: 'owner@example.test', planLabel: 'Prueba' }),
}));
afterEach(() => vi.restoreAllMocks());
it('el menú muestra todos los servicios activos y abre su ruta, sin «Próximamente»', () => {
  const navigate = vi.fn(); workspaceRefs.navigate = navigate;
  setUi({ servicesOpen: true });
  render(<MemoryRouter><ServicesMenu trigger={{ current: null }} /></MemoryRouter>);
  for (const name of ['Producto', 'Estudio', 'ERP', 'Nexus', 'Analítica', 'Captura y auditoría', 'Agentes', 'Academy', 'Logística', 'Fábrica y proveedores']) {
    expect(screen.getByRole('button', { name })).toBeEnabled();
  }
  expect(screen.queryByText(/próximamente/i)).not.toBeInTheDocument();
  // Un servicio disponible abre su ruta.
  fireEvent.click(screen.getByRole('button', { name: 'Producto' }));
  expect(navigate).toHaveBeenCalledWith('/espacio/producto', undefined);
});
it('Nexus consulta el estado real y ofrece configurar Google', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ accountEmail: 'owner@example.test', googleCloud: 'disconnected', drive: 'disconnected', projectReady: false });
  render(<QueryClientProvider client={new QueryClient()}><LiveNexus /></QueryClientProvider>);
  expect(await screen.findByText('Google Cloud')).toBeInTheDocument();
  expect(screen.getByText('Google Drive')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Configurar Google Cloud' })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/uony/services');
});
it('Producto tiene su entrada sin presentar acciones simuladas como reales', () => {
  render(<LiveServiceView service="producto" />);
  expect(screen.getByRole('heading', { name: 'Producto' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pedírselo a Uony' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /publicar/i })).not.toBeInTheDocument();
});

it('un servicio sin vista propia muestra su página con capacidades y vuelve al chat', () => {
  render(<LiveServiceView service="logistica" />);
  expect(screen.getByRole('heading', { name: 'Logística', level: 1 })).toBeInTheDocument();
  expect(screen.getByText('Seguimiento de entregas')).toBeInTheDocument();
  expect(screen.queryByText(/preparando/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pedírselo a Uony' }));
});

it('Mi cuenta mantiene Eliminar cuenta aunque el estado de servicios falle o esté bloqueado', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new Error('account_deletion_pending'));
  render(<QueryClientProvider client={new QueryClient()}><LiveServices /></QueryClientProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('No podemos comprobar tu cuenta.');
  expect(screen.getByRole('button', { name: 'Eliminar cuenta' })).toBeVisible();
});

it('la pestaña «GPSR por marca» monta el editor de marcas de la Configuración viva', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path.includes('brands') ? { brands: [] } : {}) as never);
  render(<QueryClientProvider client={new QueryClient()}><LiveServices /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: /GPSR por marca/ }));
  expect(await screen.findByRole('button', { name: 'Añadir marca' })).toBeInTheDocument();
  expect(screen.getByText('Datos de seguridad por marca')).toBeInTheDocument();
});
