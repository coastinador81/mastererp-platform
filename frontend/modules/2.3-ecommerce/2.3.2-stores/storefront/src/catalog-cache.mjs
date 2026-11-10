const MAX_AGE_MS = 30 * 60 * 1000;

export const catalogCacheKey = scope => `mastererp.storefront.catalog:${scope}`;

export function readCatalogCache(storage, scope, now = Date.now()) {
  if (!storage || !scope) return null;
  try {
    const cached = JSON.parse(storage.getItem(catalogCacheKey(scope)) || 'null');
    if (!cached?.catalog || !Number.isFinite(cached.savedAt) || now - cached.savedAt > MAX_AGE_MS) return null;
    return cached.catalog;
  } catch {
    try { storage.removeItem(catalogCacheKey(scope)); } catch { /* Storage may be unavailable. */ }
    return null;
  }
}

export function writeCatalogCache(storage, scope, catalog, now = Date.now()) {
  if (!storage || !scope || !catalog) return;
  try { storage.setItem(catalogCacheKey(scope), JSON.stringify({ savedAt: now, catalog })); }
  catch { /* A storage failure must not hide a valid API response. */ }
}
