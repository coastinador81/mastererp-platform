import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { completeLoginIfNeeded, isAuthenticated } from '../auth';
import { loadCatalog } from '../api';
import { readCatalogCache, writeCatalogCache } from '../catalog-cache.mjs';
import { storefrontScope } from '../config';
import { loadCurrentExchangeRate } from '../exchange-rate.mjs';
import {cartLineKey, type CartLine, type Product, type ProductVariant, type StorefrontCatalog} from '../types';

type StoreState = {
  catalog: StorefrontCatalog | null;
  cart: CartLine[];
  authenticated: boolean;
  loading: boolean;
  sessionLoading: boolean;
  sessionError: string;
  error: string;
  selectedNode: string;
  selectNode: (id: string) => Promise<void>;
  add: (product: Product, quantity?: number, variant?: ProductVariant) => void;
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
async function loadCatalogWithRate(nodeId?: string) {
  const catalog = await loadCatalog(nodeId);
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
  const [selectedNode, setSelectedNode] = useState(initialCatalog?.store.node_id || '');

  const refreshCatalog = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextCatalog = await loadCatalogWithRate(selectedNode || undefined);
      setCatalog(nextCatalog);
      setSelectedNode(nextCatalog.store.node_id);
      if (typeof localStorage !== 'undefined') writeCatalogCache(localStorage, storefrontScope(), nextCatalog);
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo abrir la tienda.');
    } finally { setLoading(false); }
  }, [selectedNode]);

  useEffect(() => {
    let cancelled = false;
    loadCatalogWithRate()
      .then(nextCatalog => {
        if (cancelled) return;
        setCatalog(nextCatalog);
        setSelectedNode(nextCatalog.store.node_id);
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
    catalog, cart, authenticated, loading, sessionLoading, sessionError, error, selectedNode,
    add: (product, quantity = 1, variant) => setCart(lines => {
      const key = cartLineKey({product, variant});
      const found = lines.find(line => cartLineKey(line) === key);
      return found
        ? lines.map(line => cartLineKey(line) === key ? { ...line, quantity: line.quantity + quantity } : line)
        : [...lines, { product, quantity, variant }];
    }),
    setQuantity: (id, quantity) => setCart(lines => quantity < 1
      ? lines.filter(line => cartLineKey(line) !== id)
      : lines.map(line => cartLineKey(line) === id ? { ...line, quantity } : line)),
    clearCart: () => setCart([]),
    selectNode: async id => {
      if (!id || id === selectedNode) return;
      setLoading(true); setError('');
      try {
        const next = await loadCatalogWithRate(id);
        setCatalog(next); setSelectedNode(next.store.node_id); setCart([]);
        if (typeof localStorage !== 'undefined') writeCatalogCache(localStorage, storefrontScope(), next);
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cambiar el nodo.'); }
      finally { setLoading(false); }
    },
    refreshCatalog,
    refreshSession: async () => {
      setSessionLoading(true); setSessionError('');
      try { setAuthenticated(await completeLoginIfNeeded()); }
      finally { setSessionLoading(false); }
    },
  }), [authenticated, cart, catalog, error, loading, refreshCatalog, selectedNode, sessionError, sessionLoading]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider no está disponible.');
  return value;
}
