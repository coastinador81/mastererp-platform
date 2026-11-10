import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCacheKey, readCatalogCache, writeCatalogCache } from './catalog-cache.mjs';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
};

test('keeps a real catalog isolated by tenant and domain', () => {
  const storage = memoryStorage();
  const catalog = { store: { name: 'Tienda' }, products: [] };
  writeCatalogCache(storage, 'tenant-a:store-a.test', catalog, 1_000);
  assert.deepEqual(readCatalogCache(storage, 'tenant-a:store-a.test', 2_000), catalog);
  assert.equal(readCatalogCache(storage, 'tenant-b:store-a.test', 2_000), null);
});

test('rejects expired or malformed cached catalogs', () => {
  const storage = memoryStorage();
  writeCatalogCache(storage, 'tenant-a:store.test', { products: [] }, 1_000);
  assert.equal(readCatalogCache(storage, 'tenant-a:store.test', 1_802_001), null);
  storage.setItem(catalogCacheKey('tenant-a:bad.test'), '{bad');
  assert.equal(readCatalogCache(storage, 'tenant-a:bad.test', 2_000), null);
});
