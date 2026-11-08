import { api } from '@/shared/api/client';

interface ProductMemoryResponse {
  productMemory: null | { product: { sku: string; name: string; revision: number; linkVersion: number } };
}

/** Consulta la versión persistida del vínculo justo antes de una elección explícita. */
export async function productLinkVersion(threadId: string, signal?: AbortSignal): Promise<number> {
  const result = await api.get<ProductMemoryResponse>(`/uony/threads/${encodeURIComponent(threadId)}/product-memory`, { signal });
  if (result?.productMemory === null) return 0;
  const product = result?.productMemory?.product;
  if (!product || typeof product.sku !== 'string' || typeof product.name !== 'string'
    || !Number.isSafeInteger(product.revision) || product.revision < 1
    || !Number.isSafeInteger(product.linkVersion) || product.linkVersion < 1) {
    throw new Error('No hemos podido comprobar qué ficha sigue esta conversación. Vuelve a intentarlo.');
  }
  return product.linkVersion;
}
