import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createProduct, deleteProduct, getSample, listProducts, searchProductTypes, updateProduct } from '../api/products';
import { catalogDb, handlers } from '../mocks/handlers';
import { SAMPLE_SKU, SAMPLE_VERSION, sampleProduct } from '../mocks/fixtures/sampleProduct';

// Sin latencia simulada en las pruebas.
vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => catalogDb.set([{ ...sampleProduct(), createdAt: 1 }]));
afterAll(() => server.close());

test('el catálogo empieza con el producto de ejemplo', async () => {
  const products = await listProducts();
  expect(products.map(item => item.sku)).toEqual([SAMPLE_SKU]);
  expect(products[0].name).toMatch(/^Make It Possible by Uonify/);
});

test('crear un producto lo pone el primero; un SKU repetido devuelve el mensaje del backend', async () => {
  const created = await createProduct({ name: 'Lámpara', sku: 'L1', brand: 'Nórdika' });
  expect(created).toMatchObject({ name: 'Lámpara', sku: 'L1', brand: 'Nórdika', source: 'uonify', status: 'draft' });
  expect((await listProducts()).map(item => item.sku)).toEqual(['L1', SAMPLE_SKU]);
  await expect(createProduct({ name: 'Otra', sku: 'L1' })).rejects.toThrow('Este SKU ya pertenece a otro producto.');
  await expect(createProduct({ name: '', sku: 'X' })).rejects.toThrow('El nombre y el SKU son obligatorios.');
});

test('guardar cambios conserva el sitio y puede cambiar el SKU', async () => {
  await createProduct({ name: 'Lámpara', sku: 'L1' });
  const saved = await updateProduct('L1', { name: 'Lámpara nórdica', sku: 'L2', price: '19.90' });
  expect(saved).toMatchObject({ sku: 'L2', price: '19.90', source: 'uonify' });
  expect((await listProducts()).map(item => item.sku)).toEqual(['L2', SAMPLE_SKU]);
  await expect(updateProduct('L2', { name: 'X', sku: SAMPLE_SKU })).rejects.toThrow('Este SKU ya pertenece a otro producto.');
  await expect(updateProduct('NO-EXISTE', { name: 'X', sku: 'Y' })).rejects.toThrow('Este producto ya no está en tu catálogo.');
});

test('eliminar el ejemplo lo quita del catálogo de la sesión', async () => {
  await deleteProduct(SAMPLE_SKU);
  expect(await listProducts()).toEqual([]);
  await expect(deleteProduct(SAMPLE_SKU)).rejects.toThrow();
});

test('las porciones del ejemplo llegan con su versión', async () => {
  const sample = await getSample(SAMPLE_SKU);
  expect(sample.version).toBe(SAMPLE_VERSION);
  expect(sample.slices).toHaveProperty('images');
  expect(sample.slices).toHaveProperty('gpsr');
  await expect(getSample('OTRO')).rejects.toThrow('Este producto de ejemplo no existe.');
});

test('ctx.categorySearch pide las categorías de Amazon.es y entrega el cuerpo también en .data', async () => {
  let asked = '';
  server.use(http.get('*/amazon/product-types/search', ({ request }) => {
    asked = new URL(request.url).search;
    return HttpResponse.json({ productTypes: [{ name: 'TOY_BUILDING_BLOCK', displayName: 'Bloques de construcción' }], productTypeVersion: 'LATEST' });
  }));
  const result = await searchProductTypes('juego madera');
  expect(asked).toBe('?keywords=juego+madera&marketplace_id=A1RKKUPIHCS9HS&country_code=ES');
  expect(result.productTypes.map(type => type.name)).toEqual(['TOY_BUILDING_BLOCK']);
  expect(result.data.productTypes).toEqual(result.productTypes);
  server.resetHandlers();
});
