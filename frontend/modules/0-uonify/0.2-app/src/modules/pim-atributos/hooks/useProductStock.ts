import { useEffect, useRef } from 'react';
import type { PimProduct, PimTabContext } from '@/shared/pim';
import { useLatest } from '@/shared/hooks';
import { toast } from '@/shared/ui';
import { loadStock, updateStockViaEDI } from '../api/atributosApi';
import { sheetShowsProduct } from '../model/sheet';
import type { StockData } from '../model/types';
import { memory, useAtributosMemory } from './atributosMemory';

/**
 * Stock del producto (prototipo: pim/atributos.js, E33 y StockSelector.tsx).
 * Se pide una vez por producto (no en cada montaje) y la respuesta se guarda en
 * el producto aunque la pestaña ya no esté a la vista, si la ficha sigue
 * enseñándolo. `savers` guarda, por producto, el guardado de la última vista
 * montada (mem.view / mem.lastView del prototipo).
 */
type Saver = (data: StockData) => void;
const savers = new Map<string, Saver>();

function loadProductStock(key: string, product: PimProduct | null): void {
  if (!product || (product.source !== 'amazon' && product.source !== 'shopify')) return;
  if (product.stock_data) {
    memory.patch(key, { currentStock: product.stock_data as StockData });
    return;
  }
  const mem = memory.get(key);
  if (mem.loadingStock || mem.stockRequested) return;
  memory.patch(key, { stockRequested: true, loadingStock: true });
  const identifier = String(product.asin || product.sku);
  const channel = product.source === 'shopify' ? 'shopify' : 'amazon';
  loadStock(identifier, channel)
    .then(data => {
      if (!data) return;
      memory.patch(key, { currentStock: data });
      savers.get(key)?.(data);
    })
    .catch(() => { /* el original solo lo registra en consola */ })
    .finally(() => memory.patch(key, { loadingStock: false }));
}

export function useProductStock(ctx: PimTabContext, product: PimProduct | null) {
  const { key } = ctx;
  const mem = useAtributosMemory(key);
  const mounted = useRef(false);
  const latest = useLatest({ ctx, product });

  useEffect(() => {
    mounted.current = true;
    savers.set(key, data => {
      const { ctx: current, product: target } = latest.current;
      if (!target || !sheetShowsProduct(current, target, mounted.current)) return;
      current.persist({ name: target.name, sku: target.sku, stock_data: data }, { key: target.sku }).catch(() => {
        /* el original solo lo registra en consola */
      });
    });
    return () => {
      mounted.current = false;
    };
  }, [key, latest]);

  useEffect(() => {
    if (!latest.current.ctx.isNew) loadProductStock(key, latest.current.product);
  }, [key, latest]);

  const currentStock = mem.currentStock ?? ((product?.stock_data as StockData | undefined) || null);
  const available = currentStock?.amazon_vendor?.available || false;

  async function changeStock(value: string): Promise<void> {
    const state = memory.get(key);
    if (!product || state.updatingStock || state.loadingStock) return;
    const newAvailable = value === 'available';
    memory.patch(key, { updatingStock: true });
    toast.info('📤 Actualizando stock vía EDI...');
    const result = await updateStockViaEDI({
      sku: product.sku,
      ean: product.ean,
      available: newAvailable,
      price: product.retail_price || product.price,
    });
    memory.patch(key, { updatingStock: false });
    if (!result.success) {
      toast.error(`❌ ${result.message}`);
      return;
    }
    toast.success(`✅ ${result.message}`);
    const stock = memory.get(key).currentStock ?? currentStock ?? {};
    const updated: StockData = { ...stock, amazon_vendor: { ...(stock.amazon_vendor || {}), available: newAvailable } };
    memory.patch(key, { currentStock: updated });
    savers.get(key)?.(updated);
  }

  return { available, loading: mem.loadingStock, updating: mem.updatingStock, changeStock };
}

/** Solo para pruebas: olvida los guardados registrados. */
export function resetStockSavers(): void {
  savers.clear();
}
