import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { completeLoginIfNeeded, isAuthenticated } from '../auth';
import { loadCatalog } from '../api';
import { storefrontScope } from '../config';
import type { CartLine, Product, StorefrontCatalog } from '../types';

type StoreState = {
  catalog: StorefrontCatalog | null;
  cart: CartLine[];
  authenticated: boolean;
  loading: boolean;
  error: string;
  add: (product: Product) => void;
  setQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  refreshSession: () => Promise<void>;
};

const StoreContext = createContext<StoreState | null>(null);
const cartKey = () => `mastererp.storefront.cart:${storefrontScope()}`;
function initialCart(): CartLine[] {
  if (typeof sessionStorage === 'undefined') return [];
  try { return JSON.parse(sessionStorage.getItem(cartKey()) || '[]'); }
  catch { sessionStorage.removeItem(cartKey()); return []; }
}

export function StoreProvider({ children }: PropsWithChildren) {
  const [catalog, setCatalog] = useState<StorefrontCatalog | null>(null);
  const [cart, setCart] = useState<CartLine[]>(initialCart);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextCatalog, session] = await Promise.all([
          loadCatalog(),
          completeLoginIfNeeded().catch((reason: Error) => {
            if (isAuthenticated()) return true;
            throw reason;
          }),
        ]);
        if (cancelled) return;
        setCatalog(nextCatalog);
        setAuthenticated(session);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'No se pudo abrir la tienda.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
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
    catalog, cart, authenticated, loading, error,
    add: product => setCart(lines => {
      const found = lines.find(line => line.product.id === product.id);
      return found
        ? lines.map(line => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...lines, { product, quantity: 1 }];
    }),
    setQuantity: (id, quantity) => setCart(lines => quantity < 1
      ? lines.filter(line => line.product.id !== id)
      : lines.map(line => line.product.id === id ? { ...line, quantity } : line)),
    clearCart: () => setCart([]),
    refreshSession: async () => setAuthenticated(await completeLoginIfNeeded()),
  }), [authenticated, cart, catalog, error, loading]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider no está disponible.');
  return value;
}
