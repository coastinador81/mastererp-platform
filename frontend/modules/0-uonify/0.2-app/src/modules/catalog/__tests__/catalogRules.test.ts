import { NEW_PRODUCT_KEY } from '@/shared/pim';
import {
  EMPTY_FILTERS,
  MSG_REQUIRED,
  MSG_SKU_TAKEN,
  filterProducts,
  isSkuTaken,
  mergeSaved,
  resolvePersistTarget,
  saveInCatalog,
} from '../model/catalogRules';
import { parseProductRoute, productPath, sheetKey } from '../model/paths';
import type { CatalogProduct } from '../model/types';

// Puerto de tests/product-source-layout.test.cjs («saving from a tab creates or
// updates the product and moves its tab state to the SKU») y de las reglas de la URL.

const catalog = (): CatalogProduct[] => [{ name: 'A', sku: 'A1', source: 'uonify' }];

test('guardar desde una pestaña crea el producto sin descartar nada de lo escrito', () => {
  const { target, fromKey } = resolvePersistTarget({ create: true, currentSku: null });
  expect(target).toBeNull();
  expect(fromKey).toBe(NEW_PRODUCT_KEY);
  const { products, saved } = saveInCatalog(catalog(), { name: 'Lámpara', sku: 'L1', brand: 'Nórdika', price: '10', cost: '4', stock: '3' }, { target, now: 1 });
  expect(saved.brand).toBe('Nórdika');
  expect(saved.source).toBe('uonify');
  expect(saved.status).toBe('draft');
  expect(products[0].sku).toBe('L1');
  expect(products).toHaveLength(2);
});

test('un SKU de otro producto o sin nombre se rechaza con los mensajes del prototipo', () => {
  expect(() => saveInCatalog(catalog(), { name: 'Otra', sku: 'A1' }, { target: null })).toThrow(MSG_SKU_TAKEN);
  expect(() => saveInCatalog(catalog(), { name: '', sku: 'X' }, { target: null })).toThrow(/obligatorios/);
  expect(() => saveInCatalog(catalog(), { name: 'X', sku: '   ' }, { target: null })).toThrow(MSG_REQUIRED);
});

test('actualizar mantiene el producto en su sitio y puede cambiar el SKU', () => {
  const list: CatalogProduct[] = [{ name: 'B', sku: 'B1' }, { name: 'A', sku: 'A1', brand: 'Uno' }];
  const { target, fromKey } = resolvePersistTarget({ key: 'A1', currentSku: 'B1' });
  expect(target).toBe('A1');
  expect(fromKey).toBe('A1');
  const { products, saved } = saveInCatalog(list, { name: 'A bis', sku: 'A2' }, { target });
  expect(products.map(item => item.sku)).toEqual(['B1', 'A2']);
  expect(saved.brand).toBe('Uno');
  expect(mergeSaved(list, saved, 'A1').map(item => item.sku)).toEqual(['B1', 'A2']);
});

test('sin clave, guarda en la ficha abierta; la clave «__new__» también', () => {
  expect(resolvePersistTarget({ currentSku: 'C1' })).toEqual({ target: 'C1', fromKey: 'C1' });
  expect(resolvePersistTarget({ key: NEW_PRODUCT_KEY, currentSku: 'C1' })).toEqual({ target: 'C1', fromKey: 'C1' });
});

test('skuTaken no cuenta el SKU del propio producto', () => {
  const list = catalog();
  expect(isSkuTaken(list, 'A1', null)).toBe(true);
  expect(isSkuTaken(list, ' A1 ', 'A1')).toBe(false);
  expect(isSkuTaken(list, 'Z9', null)).toBe(false);
});

test('la búsqueda filtra por nombre o SKU y los filtros por estado y fuente', () => {
  const list: CatalogProduct[] = [
    { name: 'Lámpara nórdica', sku: 'LAM-1', status: 'draft', source: 'uonify' },
    { name: 'Taza', sku: 'TAZ-2', status: 'published', source: 'amazon' },
  ];
  expect(filterProducts(list, { ...EMPTY_FILTERS, search: 'lám' }).map(item => item.sku)).toEqual(['LAM-1']);
  expect(filterProducts(list, { ...EMPTY_FILTERS, search: 'taz-2' }).map(item => item.sku)).toEqual(['TAZ-2']);
  expect(filterProducts(list, { ...EMPTY_FILTERS, status: 'published' }).map(item => item.sku)).toEqual(['TAZ-2']);
  expect(filterProducts(list, { ...EMPTY_FILTERS, source: 'uonify' }).map(item => item.sku)).toEqual(['LAM-1']);
});

test('rutas del servicio Producto', () => {
  expect(productPath()).toBe('/espacio/producto');
  expect(productPath({ sku: 'UON-KIT-01' })).toBe('/espacio/producto/UON-KIT-01');
  expect(productPath({ sku: 'UON-KIT-01', tab: 'atributos' })).toBe('/espacio/producto/UON-KIT-01');
  expect(productPath({ sku: 'A/1', tab: 'gpsr' })).toBe('/espacio/producto/A%2F1/gpsr');
  expect(productPath({ isNew: true, tab: 'video' })).toBe('/espacio/producto/nuevo/video');
  expect(parseProductRoute({ sku: 'nuevo' })).toEqual({ sku: null, isNew: true, tab: 'atributos' });
  expect(parseProductRoute({ sku: 'A1', tab: 'aplus' })).toEqual({ sku: 'A1', isNew: false, tab: 'aplus' });
  expect(parseProductRoute({ sku: 'A1', tab: 'desconocida' }).tab).toBe('atributos');
  expect(sheetKey({ sku: null, isNew: false })).toBe('none');
});
