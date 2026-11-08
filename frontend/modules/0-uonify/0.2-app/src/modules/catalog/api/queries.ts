import { currentAccountEmail } from '@/modules/auth';
import { USE_MOCKS } from '@/shared/api/config';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { CatalogProduct, SampleDefinition } from '../model/types';
import { getSample, listProducts } from './products';

/** Claves de TanStack Query del servicio Producto. */
export const catalogKeys = {
  all: ['catalog'] as const,
  products: ['catalog', 'products'] as const,
  sample: (id: string) => ['catalog', 'sample', id] as const,
};

const productsKey = () => USE_MOCKS ? catalogKeys.products : [...catalogKeys.products, currentAccountEmail()];

/** El catálogo (GET /products). Las mutaciones actualizan la caché en su sitio. */
export function useProducts() {
  return useQuery({ queryKey: productsKey(), queryFn: listProducts, staleTime: USE_MOCKS ? 5 * 60_000 : 0 });
}

export function getCachedProducts(client: QueryClient): CatalogProduct[] {
  return client.getQueryData<CatalogProduct[]>(productsKey()) ?? [];
}

export function setCachedProducts(client: QueryClient, update: (products: CatalogProduct[]) => CatalogProduct[]): void {
  client.setQueryData<CatalogProduct[]>(productsKey(), current => update(current ?? []));
}

/** Porciones del producto de ejemplo (no cambian en la sesión). */
export function fetchSample(client: QueryClient, id: string): Promise<SampleDefinition> {
  return client.fetchQuery({ queryKey: catalogKeys.sample(id), queryFn: () => getSample(id), staleTime: Infinity });
}
