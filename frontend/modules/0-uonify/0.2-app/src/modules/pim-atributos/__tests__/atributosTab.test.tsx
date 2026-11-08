import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { getPublisher, pimStore, type PimProduct } from '@/shared/pim';
import { mock } from '@/shared/mocks/utils';
import { toast } from '@/shared/ui';
import { tab } from '..';
import { memory } from '../hooks/atributosMemory';
import { handlers } from '../mocks/handlers';
import { makeContext, renderTab } from './helpers';

const server = setupServer(...handlers);
const listingBodies: Array<Record<string, unknown>> = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  pimStore.clear();
  memory.reset();
  listingBodies.length = 0;
  server.use(http.put(mock('/amazon/products'), async ({ request }) => {
    listingBodies.push(await request.clone().json() as Record<string, unknown>);
  }));
});
afterEach(() => {
  server.resetHandlers();
  act(() => toast.dismiss());
});
afterAll(() => server.close());

describe('Atributos · Nuevo Producto', () => {
  test('crear exige nombre y SKU y guarda todos los datos con los campos confirmados', async () => {
    const user = userEvent.setup();
    const ctx = makeContext(null);
    renderTab(tab, ctx);
    const create = screen.getByRole('button', { name: 'Crear Producto' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('Título del Producto'), 'Taza de cerámica');
    await user.type(screen.getByLabelText('SKU'), 'TZ-01');
    await user.type(screen.getByLabelText('Precio de Venta'), '12.5');
    expect(create).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Agregar Campo Personalizado' }));
    const name = screen.getByLabelText('Nombre del Campo');
    expect(name).toHaveFocus();
    expect(create).toBeDisabled();
    expect(screen.getByText(/Confirma todos los campos personalizados antes de crear el producto/)).toBeVisible();
    await user.type(name, 'Color');
    await user.type(screen.getByLabelText('Valor'), 'Azul');
    await user.click(screen.getByRole('button', { name: 'Confirmar Campo' }));
    expect(screen.getByRole('button', { name: 'Editar campo Color' })).toHaveFocus();
    expect(screen.getByText('Confirmado')).toBeInTheDocument();

    await user.click(create);
    await waitFor(() => expect(ctx.persist).toHaveBeenCalledTimes(1));
    const [data, options] = ctx.persist.mock.calls[0];
    expect(options).toEqual({ create: true });
    expect(data).toMatchObject({ name: 'Taza de cerámica', sku: 'TZ-01', price: '12.5', source: 'uonify', status: 'draft' });
    expect(data.customFields).toEqual([expect.objectContaining({ name: 'Color', value: 'Azul', isConfirmed: true })]);
    expect(pimStore.get('TZ-01', 'edited')).toEqual({});
  });

  test('«Generar con Uony» pide al menos nombre o marca y rellena el título con Uony', async () => {
    const user = userEvent.setup();
    renderTab(tab, makeContext(null));
    await user.click(screen.getByRole('button', { name: 'Generar con Uony' }));
    expect(await screen.findByText(/Agrega al menos un nombre o marca/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Marca'), 'Uonify');
    await user.type(screen.getByLabelText('Título del Producto'), 'juego de piezas');
    await user.click(screen.getByRole('button', { name: 'Generar con Uony' }));
    await waitFor(() => expect(screen.getByLabelText('Título del Producto')).toHaveValue('Uonify Juego de piezas, diseño resistente y fácil de usar'));
    expect(await screen.findByText('✅ Título generado con Uony')).toBeInTheDocument();
  });

  test('el buscador de categorías lista las de Amazon y se elige con el teclado', async () => {
    const user = userEvent.setup();
    renderTab(tab, makeContext(null));
    const input = screen.getByRole('combobox', { name: 'Categoría' });
    await user.type(input, 'juguete');
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').length).toBeGreaterThan(1);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}');
    const first = within(list).getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    const technical = first.querySelector('small')?.textContent;
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(pimStore.get<Record<string, unknown>>('__new__', 'edited').category).toBe(technical);
    expect(input).toHaveValue(first.querySelector('strong')?.textContent);
    expect(input).toHaveFocus();
  });
});

describe('Atributos · producto guardado', () => {
  const product: PimProduct = { sku: 'UON-1', name: 'Taza', brand: 'Uonify', price: '9.90', source: 'uonify', bullets: ['Cerámica', 'Apta para lavavajillas'] };

  test('«Guardar Cambios» guarda precio, viñetas y campos; sin canales avisa del guardado local', async () => {
    const user = userEvent.setup();
    pimStore.set('UON-1', 'customFields', [{ id: 'f1', name: 'Material', type: 'text', value: 'Gres', options: [], isConfirmed: true }]);
    const ctx = makeContext(product);
    renderTab(tab, ctx);
    const save = screen.getByRole('button', { name: /Guardar Cambios/ });
    expect(save).toHaveTextContent('Guardar Cambios (1)');
    const price = screen.getByLabelText('Precio de Venta (PVPR)');
    await user.clear(price);
    await user.type(price, '14');
    await user.click(save);
    await waitFor(() => expect(ctx.persist).toHaveBeenCalled());
    const [data, options] = ctx.persist.mock.calls[0];
    expect(options).toEqual({ key: 'UON-1' });
    expect(data).toMatchObject({ price: '14', bullet_points: ['Cerámica', 'Apta para lavavajillas'], bullets: ['Cerámica', 'Apta para lavavajillas'] });
    expect(data.customFields).toHaveLength(1);
    expect(await screen.findByText('✅ Cambios guardados localmente')).toBeInTheDocument();
    expect(listingBodies).toHaveLength(0);
  });

  test('con Amazon activo crea el listing (sin datos GPSR de ejemplo) y lo avisa', async () => {
    const user = userEvent.setup();
    const ctx = makeContext(product, { channels: () => ({ Amazon: true }) });
    renderTab(tab, ctx);
    await user.click(screen.getByRole('button', { name: /Guardar Cambios/ }));
    expect(await screen.findByText('✅ Listing creado en Amazon')).toBeInTheDocument();
    expect(listingBodies[0]).toMatchObject({ sku: 'UON-1', item_name: 'Taza', bullet_points: ['Cerámica', 'Apta para lavavajillas'] });
    expect(JSON.stringify(listingBodies[0])).not.toMatch(/example\.com|Calle Ejemplo/);
    await waitFor(() => expect(ctx.persist).toHaveBeenCalled());
  });

  test('un producto de Amazon carga su stock y lo cambia por EDI', async () => {
    const user = userEvent.setup();
    const amazon: PimProduct = { ...product, sku: 'AMZ-9', source: 'amazon', asin: 'B0AMZ9' };
    const ctx = makeContext(amazon);
    renderTab(tab, ctx);
    const stock = screen.getByLabelText('Stock');
    await waitFor(() => expect(stock).toHaveValue('available'));
    expect(stock).toHaveClass('is-available');
    await waitFor(() => expect(ctx.persist).toHaveBeenCalledWith(expect.objectContaining({ sku: 'AMZ-9', stock_data: expect.any(Object) }), { key: 'AMZ-9' }));
    await user.selectOptions(stock, 'unavailable');
    expect(await screen.findByText('✅ Stock actualizado vía EDI')).toBeInTheDocument();
    await waitFor(() => expect(stock).toHaveValue('unavailable'));
    expect(screen.queryByText('Stock (Amazon Vendor)')).toBeNull();
  });
});

describe('Publicar en Amazon (portado de tests/publish-and-cleanup.test.cjs)', () => {
  test('el publicador de Amazon está registrado y hace el mismo envío que «Guardar Cambios»', async () => {
    const publish = getPublisher('Amazon');
    expect(publish).toBeTypeOf('function');
    await expect(publish!({ sku: 'P1', name: 'Taza', bullet_points: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'], images: ['https://cdn/a.jpg'] }))
      .resolves.toEqual({ status: 'ACCEPTED', issues: [] });
    expect(listingBodies[0]).toMatchObject({ sku: 'P1', item_name: 'Taza' });
    const update = await publish!({ sku: 'P2', name: 'Taza', source: 'amazon', bullet_points: ['Uno'] });
    expect(update.issues[0]).toMatchObject({ severity: 'WARNING', attributeName: 'bullet_point' });
    expect(listingBodies[1]).toHaveProperty('attributes');
    await expect(publish!({ sku: '', name: 'Sin SKU' })).rejects.toThrow('Falta el SKU del vendedor.');
  });
});
