import { useProducts } from '../api/queries';
import type { CatalogProduct } from '../model/types';

/** Un producto del catálogo (null si no existe o aún no se ha cargado). */
export function useCatalogProduct(sku: string | null | undefined): CatalogProduct | null {
  const { data } = useProducts();
  if (!sku) return null;
  return data?.find(item => item.sku === sku) ?? null;
}
