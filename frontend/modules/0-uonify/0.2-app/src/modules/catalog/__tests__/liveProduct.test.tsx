import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { api } from '@/shared/api/client';
import { hasProductEdits, notifyProductChanges, pimStore } from '@/shared/pim';

import { useCatalogStore } from '../hooks/useCatalogStore';

vi.mock('@/shared/api/config', async original => ({ ...await original<typeof import('@/shared/api/config')>(), USE_MOCKS: false }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'one@example.test' }));
vi.mock('@/modules/workspace', () => ({
  TopbarCenter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationDock: () => <div>Chat real</div>,
  useWorkspaceUi: () => ({ isConversationOpen: true, isNavigationOpen: false, setSheetTitle: () => {}, announce: () => {}, focusComposer: () => {} }),
}));
const { workspaceRoutes } = await import('../routes');
const original = { sku: 'P-1', name: 'Juego', brand: 'Uonify', revision: 1, customFields: [], bullets: ['Inicial'] };
beforeEach(() => {
  pimStore.clear();
  useCatalogStore.setState({ drawer: { open: false, pinned: false }, layoutReady: false, selection: [], channelStates: {}, publishRequest: null, redirect: null });
});
afterEach(() => vi.restoreAllMocks());
function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/espacio', element: <Outlet />, children: workspaceRoutes }], { initialEntries: [path] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router };
}

it('crea desde la ficha aprobada usando API real y mantiene Amazon inactivo', async () => {
  let created = false;
  vi.spyOn(api, 'get').mockImplementation(async () => ({ products: created ? [original] : [] }));
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { created = true; return { product: original }; });
  const { router } = mount('/espacio/producto/nuevo');
  fireEvent.change(await screen.findByRole('textbox', { name: 'Título del Producto' }), { target: { value: 'Juego' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'SKU' }), { target: { value: 'P-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear Producto' }));
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][0]).toBe('/products');
  expect(post.mock.calls[0][1]).toMatchObject({ sku: 'P-1', name: 'Juego' });
  expect(post.mock.calls[0][1]).not.toHaveProperty('image');
  await waitFor(() => expect(router.state.location.pathname).toBe('/espacio/producto/P-1'));
  expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
});

it('guarda descripciones con revisión y conserva el borrador ante conflicto', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ products: [original] });
  const patch = vi.spyOn(api, 'patch').mockRejectedValue(new Error('La ficha ha cambiado'));
  const changed = vi.fn();
  window.addEventListener('uonify:products-changed', changed);
  mount('/espacio/producto/P-1/descripciones');
  await screen.findByRole('button', { name: 'Guardar descripciones' });
  act(() => { pimStore.set('P-1', 'edited', { description: 'Edición manual' }); });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar descripciones' }));
  await waitFor(() => expect(patch).toHaveBeenCalledOnce());
  expect(patch.mock.calls[0][1]).toMatchObject({ revision: 1, description: 'Edición manual', bullets: ['Inicial'] });
  expect(pimStore.get('P-1', 'edited')).toEqual({ description: 'Edición manual' });
  expect(changed).not.toHaveBeenCalled();
  window.removeEventListener('uonify:products-changed', changed);
});

it('guardar Basic desde Producto notifica el cambio una sola vez con la revisión guardada', async () => {
  const basic = { ...original, sku: 'BASIC-QA', name: 'Basic Mini Bricks' };
  const saved = { ...basic, revision: 2, description: 'Nueva descripción' };
  let revision = 1;
  const changes: unknown[] = [];
  const record = (event: Event) => changes.push((event as CustomEvent).detail);
  window.addEventListener('uonify:products-changed', record);
  vi.spyOn(api, 'get').mockImplementation(async () => ({ products: [revision === 1 ? basic : saved] }));
  const patch = vi.spyOn(api, 'patch').mockImplementation(async () => { revision = 2; return { product: saved }; });
  try {
    mount('/espacio/producto/BASIC-QA/descripciones');
    await screen.findByRole('button', { name: 'Guardar descripciones' });
    act(() => { pimStore.set('BASIC-QA', 'edited', { description: 'Nueva descripción' }); });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar descripciones' }));
    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    await waitFor(() => expect(changes).toHaveLength(1));
    expect(changes).toEqual([[{ product: saved, previousSku: 'BASIC-QA' }]]);
  } finally { window.removeEventListener('uonify:products-changed', record); }
});

it('un cambio de Uony refresca la misma ficha y no descarta ediciones locales', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ products: [original] });
  mount('/espacio/producto/P-1');
  await screen.findByRole('heading', { name: 'Juego', level: 1 });
  await waitFor(() => expect(pimStore.get('P-1', 'baseRevision')).toBe(1));
  expect(hasProductEdits(original)).toBe(false);
  const saved = { ...original, name: 'Juego actualizado', revision: 2, customFields: [{ id: 'material', name: 'Material', type: 'text', value: 'Madera', options: [], isConfirmed: true }] };
  get.mockResolvedValue({ products: [saved] });
  act(() => notifyProductChanges([{ product: saved, previousSku: 'P-1' }]));
  await screen.findByRole('heading', { name: 'Juego actualizado', level: 1 });
  expect(await screen.findByRole('textbox', { name: 'Nombre del Producto' })).toHaveValue('Juego actualizado');
  expect(pimStore.get('P-1', 'customFields')).toEqual(saved.customFields);
  expect(hasProductEdits(saved)).toBe(false);
  act(() => pimStore.set('P-1', 'edited', { name: 'Mi edición pendiente' }));
  get.mockResolvedValue({ products: [{ ...saved, revision: 3 }] });
  act(() => notifyProductChanges([{ product: { ...saved, revision: 3 }, previousSku: 'P-1' }]));
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path === '/products')).toHaveLength(3));
  expect(pimStore.get('P-1', 'edited')).toEqual({ name: 'Mi edición pendiente' });
  expect(pimStore.get('P-1', 'baseRevision')).toBe(2);
});

it('abre la experiencia real de Blender dentro de la pestaña3D de un producto guardado', async () => {
  const productId = '458ad58c-345b-4d8f-bb62-2fe202f3b8e0';
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/connections/blender-local'
    ? { status: 'offline', deviceName: 'Mi Mac', blenderVersion: null, scene: null, capabilities: [], accessAllowed: true } as never
    : { products: [{ ...original, id: productId }] } as never);
  mount('/espacio/producto/P-1/modelos3d');
  expect(await screen.findByText('Equipo sin conexión')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '3D' })).toHaveAttribute('aria-selected', 'true');
  expect(api.get).toHaveBeenCalledWith('/connections/blender-local', expect.objectContaining({ params: { productId } }));
  expect(screen.queryByText(/Esta parte de la ficha se incorporará/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Generar Modelo 3D' })).not.toBeInTheDocument();
});

it.each(['auditoria', 'imagenes', 'video', 'aplus'])('la pestaña %s carga preparación persistida en lugar de un módulo simulado', async tab => {
  const preparation = { product: original, preparation: { mode: 'manual', activeSection: tab, briefReady: false, sections: [{
    id: tab, label: 'Preparación de prueba', kind: 'planning', state: 'saved', notice: 'Recursos todavía pendientes.',
    fields: [{ id: 'brief', label: 'Encargo guardado', type: 'textarea', required: false, value: 'Datos del cliente' }],
  }] } };
  vi.spyOn(api, 'get').mockImplementation(async path => (path.endsWith('/preparation') ? preparation : { products: [original] }) as never);
  const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...preparation, product: { ...original, revision: 2 } });
  mount(`/espacio/producto/P-1/${tab}`);
  expect(await screen.findByLabelText('Encargo guardado')).toHaveValue('Datos del cliente');
  expect(screen.queryByText(/Esta parte de la ficha se incorporará/)).not.toBeInTheDocument();
  expect(screen.getByText('Recursos todavía pendientes.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Encargo guardado'), { target: { value: 'Encargo actualizado' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/products/P-1/preparation', expect.objectContaining({ section: tab, revision: 1, answers: { brief: 'Encargo actualizado' } }), expect.objectContaining({ signal: expect.any(AbortSignal) })));
});

it('la pestaña gpsr monta el editor GPSR real (UE), no el panel de preparación', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => (path.startsWith('/brands/') ? { brand: null } : { products: [original] }) as never);
  mount('/espacio/producto/P-1/gpsr');
  expect(await screen.findByRole('button', { name: 'Guardar GPSR' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'GPSR' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByText(/Preparación manual/)).not.toBeInTheDocument();
});
