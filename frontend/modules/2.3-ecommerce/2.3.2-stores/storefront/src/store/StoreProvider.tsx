import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { completeLoginIfNeeded, isAuthenticated } from '../auth';
import { loadCatalog } from '../api';
import { readCatalogCache, writeCatalogCache } from '../catalog-cache.mjs';
import { storefrontScope } from '../config';
import { loadCurrentExchangeRate } from '../exchange-rate.mjs';
import type { CartLine, Product, StorefrontCatalog } from '../types';

type StoreState = {
  catalog: StorefrontCatalog | null;
  cart: CartLine[];
  authenticated: boolean;
  loading: boolean;
  sessionLoading: boolean;
  sessionError: string;
  error: string;
  add: (product: Product, quantity?: number) => void;
  setQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  refreshCatalog: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const StoreContext = createContext<StoreState | null>(null);
const cartKey = () => `mastererp.storefront.cart:${storefrontScope()}`;
const cachedCatalog = () => typeof localStorage === 'undefined'
  ? null
  : readCatalogCache(localStorage, storefrontScope()) as StorefrontCatalog | null;
async function loadCatalogWithRate() {
  const catalog = await loadCatalog();
  const exchangeRate = await loadCurrentExchangeRate().catch(() => null);
  if (!exchangeRate) return catalog;
  return {...catalog, store:{...catalog.store, configuration:{...catalog.store.configuration, exchangeRate}}};
}
function initialCart(): CartLine[] {
  if (typeof sessionStorage === 'undefined') return [];
  try { return JSON.parse(sessionStorage.getItem(cartKey()) || '[]'); }
  catch { sessionStorage.removeItem(cartKey()); return []; }
}

export function StoreProvider({ children }: PropsWithChildren) {
  const initialCatalog = useMemo(() => cachedCatalog(), []);
  const [catalog, setCatalog] = useState<StorefrontCatalog | null>(initialCatalog);
  const [cart, setCart] = useState<CartLine[]>(initialCart);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(initialCatalog === null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [error, setError] = useState('');

  const refreshCatalog = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextCatalog = await loadCatalogWithRate();
      setCatalog(nextCatalog);
      if (typeof localStorage !== 'undefined') writeCatalogCache(localStorage, storefrontScope(), nextCatalog);
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo abrir la tienda.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCatalogWithRate()
      .then(nextCatalog => {
        if (cancelled) return;
        setCatalog(nextCatalog);
        if (typeof localStorage !== 'undefined') writeCatalogCache(localStorage, storefrontScope(), nextCatalog);
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'No se pudo abrir la tienda.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    completeLoginIfNeeded()
      .then(session => { if (!cancelled) setAuthenticated(session); })
      .catch(reason => {
        if (cancelled) return;
        setAuthenticated(isAuthenticated());
        setSessionError(reason instanceof Error ? reason.message : 'No se pudo recuperar la sesión.');
      })
      .finally(() => { if (!cancelled) setSessionLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => {
      if (!isAuthenticated()) setAuthenticated(false);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [authenticated]);

  useEffect(() => { if (!loading && typeof sessionStorage !== 'undefined') sessionStorage.setItem(cartKey(), JSON.stringify(cart)); }, [cart, loading]);

  const value = useMemo<StoreState>(() => ({
    catalog, cart, authenticated, loading, sessionLoading, sessionError, error,
    add: (product, quantity = 1) => setCart(lines => {
      const found = lines.find(line => line.product.id === product.id);
      return found
        ? lines.map(line => line.product.id === product.id ? { ...line, quantity: line.quantity + quantity } : line)
        : [...lines, { product, quantity }];
    }),
    setQuantity: (id, quantity) => setCart(lines => quantity < 1
      ? lines.filter(line => line.product.id !== id)
      : lines.map(line => line.product.id === id ? { ...line, quantity } : line)),
    clearCart: () => setCart([]),
    refreshCatalog,
    refreshSession: async () => {
      setSessionLoading(true); setSessionError('');
      try { setAuthenticated(await completeLoginIfNeeded()); }
      finally { setSessionLoading(false); }
    },
  }), [authenticated, cart, catalog, error, loading, refreshCatalog, sessionError, sessionLoading]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider no está disponible.');
  return value;
}
