import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { api } from '@/shared/api/client';
import { PimTabHost } from '@/shared/pim';
import { tab } from '../index';
import { makeContext } from './testUtils';

vi.mock('@/shared/api/config', async original => ({ ...await original<typeof import('@/shared/api/config')>(), USE_MOCKS: false }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'owner@example.test' }));
const productId = '458ad58c-345b-4d8f-bb62-2fe202f3b8e0';
const base = '/connections/blender-local';
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('la pestaña3D real consulta Blender por ID interno y deja fuera generación/subida/AR simuladas', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ status: 'offline', deviceName: 'Mi Mac', blenderVersion: null, lastSeenAt: null, scene: null, capabilities: [], accessAllowed: true });
  render(<QueryClientProvider client={client()}><MemoryRouter><PimTabHost tab={tab} context={makeContext('SKU-DISTINTO', { id: productId, sku: 'SKU-DISTINTO', name: 'Mi producto' })} /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('Equipo sin conexión')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Modelos 3D' })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith(base, expect.objectContaining({ params: { productId } }));
  expect(screen.queryByRole('button', { name: 'Generar Modelo 3D' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Subir Modelo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Vista AR' })).not.toBeInTheDocument();
});

it('un producto sin guardar remite a atributos y no inicia peticiones sin ámbito', () => {
  const get = vi.spyOn(api, 'get');
  const context = makeContext('__new__'); context.switchTab = vi.fn();
  render(<QueryClientProvider client={client()}><MemoryRouter><PimTabHost tab={tab} context={context} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByText('Guarda el producto para empezar')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ir a atributos' }));
  expect(context.switchTab).toHaveBeenCalledWith('atributos');
  expect(get).not.toHaveBeenCalled();
});
