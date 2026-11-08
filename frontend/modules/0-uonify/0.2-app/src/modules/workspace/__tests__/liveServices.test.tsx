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
it('el menú compacto muestra los servicios disponibles y abre su ruta; los demás están «Próximamente»', () => {
  const navigate = vi.fn(); workspaceRefs.navigate = navigate;
  setUi({ servicesOpen: true });
  render(<MemoryRouter><ServicesMenu trigger={{ current: null }} /></MemoryRouter>);
  // A la vista (dueño 23-10): Producto, Estudio, ERP y Nexus.
  for (const name of ['Producto', 'Estudio', 'ERP', 'Nexus']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  // El resto no se muestra hasta desplegar «Más servicios».
  expect(screen.queryByRole('button', { name: 'Analítica' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Más servicios/ }));
  const analitica = screen.getByRole('button', { name: /Analítica/ });
  expect(analitica).toBeDisabled();
  expect(analitica).toHaveTextContent('Próximamente');
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
  expect(screen.getByText('Estamos preparando este servicio')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /publicar/i })).not.toBeInTheDocument();
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
