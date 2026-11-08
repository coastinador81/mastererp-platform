import type { ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { setupServer } from 'msw/node';
import { DialogHost } from '@/shared/ui';
import { pimStore, registerPublisher, useTabContext, type PimTabDefinition } from '@/shared/pim';
import { catalogDb, handlers } from '../mocks/handlers';
import { SAMPLE_NAME, SAMPLE_SKU, sampleProduct } from '../mocks/fixtures/sampleProduct';
import { useCatalogStore } from '../hooks/useCatalogStore';
import { workspaceRoutes } from '../routes';

vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const ui = vi.hoisted(() => ({
  isConversationOpen: true,
  isNavigationOpen: false,
  openConversation: vi.fn(),
  closeConversation: vi.fn(),
  toggleConversation: vi.fn(),
  openNavigation: vi.fn(),
  closeNavigation: vi.fn(),
  toggleNavigation: vi.fn(),
  selectService: vi.fn(),
  startNewThread: vi.fn(),
  focusComposer: vi.fn(),
  announce: vi.fn(),
  setSheetTitle: vi.fn(),
}));

vi.mock('@/modules/workspace', () => ({
  TopbarCenter: ({ children }: { children: ReactNode }) => <div data-testid="topbar-center">{children}</div>,
  ConversationDock: () => <div data-testid="conversation-dock" />,
  useWorkspaceUi: () => ui,
}));

// Una pestaña de prueba que guarda con ctx.persist, como Atributos.
function FakeTab() {
  const ctx = useTabContext();
  return (
    <div>
      <p>Pestaña de {ctx.key}</p>
      <button type="button" onClick={() => void ctx.persist({ name: 'Lámpara nórdica', sku: 'LAM-1', brand: 'Nórdika' }, { create: true })}>Guardar y Crear</button>
      <button type="button" onClick={() => ctx.edit({ name: 'Nombre en vivo' })}>Escribir nombre</button>
    </div>
  );
}

vi.mock('../tabs', () => ({
  PIM_TAB_DEFINITIONS: [
    { key: 'atributos', label: 'Atributos', icon: null, component: FakeTab },
    { key: 'gpsr', label: 'GPSR', icon: 'shield', component: () => <p>GPSR de prueba</p> },
  ] satisfies PimTabDefinition[],
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  catalogDb.set([{ ...sampleProduct(), createdAt: 1 }]);
  pimStore.clear();
  useCatalogStore.setState({ drawer: { open: false, pinned: false }, layoutReady: false, selection: [], channelStates: {}, channelMenuFor: null, publishRequest: null, redirect: null });
  vi.clearAllMocks();
});

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/espacio', element: <Outlet />, children: workspaceRoutes }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <DialogHost />
    </QueryClientProvider>,
  );
  return router;
}

test('sin ficha: catálogo con el ejemplo, conversación centrada y Amazon como conector', async () => {
  renderAt('/espacio/producto');
  const drawer = screen.getByRole('complementary', { name: 'Catálogo de productos' });
  expect(await within(drawer).findByText(SAMPLE_NAME)).toBeInTheDocument();
  expect(within(drawer).getByText('1 producto')).toBeInTheDocument();
  expect(screen.getByTestId('conversation-dock')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Amazon: conexión y publicación' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('group', { name: 'Canales de venta' })).toBeInTheDocument();
});

test('abrir el ejemplo: cabecera, pestañas, porciones sembradas y Amazon por producto', async () => {
  const user = userEvent.setup();
  const router = renderAt('/espacio/producto');
  await user.click(await screen.findByRole('button', { name: new RegExp(SAMPLE_SKU) }));
  expect(router.state.location.pathname).toBe(`/espacio/producto/${SAMPLE_SKU}`);
  expect(await screen.findByText(`Pestaña de ${SAMPLE_SKU}`)).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: SAMPLE_NAME })).toBeInTheDocument();
  expect(screen.getByText('Borrador')).toBeInTheDocument();
  expect(pimStore.get<unknown[]>(SAMPLE_SKU, 'images')).toHaveLength(8);
  expect(screen.getByRole('tab', { name: 'Atributos' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByRole('tab')).toHaveLength(8);
  await user.click(screen.getByRole('tab', { name: 'GPSR' }));
  expect(router.state.location.pathname).toBe(`/espacio/producto/${SAMPLE_SKU}/gpsr`);
  expect(await screen.findByText('GPSR de prueba')).toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Publicar en Amazon' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(useCatalogStore.getState().channelStates[SAMPLE_SKU]).toEqual({ Amazon: true });
});

test('nuevo producto: la cabecera sigue lo escrito y «Guardar y Crear» abre su ficha', async () => {
  const user = userEvent.setup();
  const router = renderAt('/espacio/producto/nuevo');
  expect(await screen.findByText('Pestaña de __new__')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Nuevo Producto' })).toBeInTheDocument();
  expect(screen.getByText('Creando...')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Eliminar producto' })).not.toBeInTheDocument();
  const publish = screen.getByRole('button', { name: 'Publicar' });
  expect(publish).toHaveAttribute('aria-disabled', 'true');
  await user.click(publish);
  expect(ui.announce).toHaveBeenCalledWith('Guarda el producto para publicarlo.');
  await user.click(screen.getByRole('button', { name: 'Escribir nombre' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Nombre en vivo' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Guardar y Crear' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/espacio/producto/LAM-1'));
  expect(await screen.findByText('Pestaña de LAM-1')).toBeInTheDocument();
  expect(pimStore.get(SAMPLE_SKU, 'edited')).toBeUndefined();
  expect(pimStore.get<{ name: string }>('LAM-1', 'edited').name).toBe('Nombre en vivo');
  expect(catalogDb.get().map(item => item.sku)).toEqual(['LAM-1', SAMPLE_SKU]);
});

test('«Publicar» revisa la ficha, envía por el canal y lo deja activo', async () => {
  const user = userEvent.setup();
  const unregister = registerPublisher('Amazon', async () => ({ status: 'ACCEPTED', issues: [] }));
  renderAt(`/espacio/producto/${SAMPLE_SKU}`);
  await screen.findByText(`Pestaña de ${SAMPLE_SKU}`);
  await user.click(screen.getByRole('button', { name: 'Publicar' }));
  const dialog = await screen.findByRole('dialog', { name: `Publicar «${SAMPLE_NAME}»` });
  expect(within(dialog).getByText('Listo')).toBeInTheDocument();
  expect(within(dialog).getByRole('status')).toHaveTextContent('1 producto listo.');
  await user.click(within(dialog).getByRole('button', { name: 'Publicar 1 producto' }));
  expect(await within(dialog).findByText('Enviado')).toBeInTheDocument();
  expect(within(dialog).getByRole('status')).toHaveTextContent('1 producto enviado de 1.');
  expect(useCatalogStore.getState().channelStates[SAMPLE_SKU]).toEqual({ Amazon: true });
  const footer = dialog.querySelector<HTMLElement>('.pim-dialog-footer');
  await user.click(within(footer ?? dialog).getByRole('button', { name: 'Cerrar' }));
  expect(screen.queryByRole('dialog', { name: /^Publicar/ })).not.toBeInTheDocument();
  unregister();
});

test('casillas del catálogo: barra de selección y publicar varios', async () => {
  const user = userEvent.setup();
  renderAt('/espacio/producto');
  const box = await screen.findByRole('checkbox', { name: `Seleccionar «${SAMPLE_NAME}» para publicar` });
  const bar = document.querySelector<HTMLElement>('.product-bulk-bar');
  if (!bar) throw new Error('falta la barra de selección');
  expect(bar).toHaveAttribute('role', 'region');
  expect(bar).not.toBeVisible();
  await user.click(box);
  expect(bar).toBeVisible();
  expect(within(bar).getByText('seleccionado', { exact: false })).toHaveTextContent('1 seleccionado');
  await user.click(within(bar).getByRole('button', { name: 'Quitar selección' }));
  expect(box).not.toBeChecked();
});

test('eliminar el producto pide confirmación y vuelve al catálogo', async () => {
  const user = userEvent.setup();
  const router = renderAt(`/espacio/producto/${SAMPLE_SKU}`);
  await screen.findByText(`Pestaña de ${SAMPLE_SKU}`);
  await user.click(screen.getByRole('button', { name: 'Eliminar producto' }));
  const confirm = await screen.findByRole('dialog', { name: `¿Eliminar el producto «${SAMPLE_NAME}» de este catálogo?` });
  await act(async () => {
    await user.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
  });
  await waitFor(() => expect(router.state.location.pathname).toBe('/espacio/producto'));
  expect(await screen.findByText('Tu catálogo empieza aquí')).toBeInTheDocument();
  await waitFor(() => expect(catalogDb.get()).toEqual([]));
  await waitFor(() => expect(pimStore.all(SAMPLE_SKU)).toEqual({}));
});
