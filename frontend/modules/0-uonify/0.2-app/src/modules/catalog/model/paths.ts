import { isPimTabKey, type PimTabKey } from '@/shared/pim';
import type { ProductRoute } from './types';

/**
 * URL del servicio Producto (en el prototipo: ?service=producto y el estado
 * selectedProductSku / serviceView / productTab):
 *   /espacio/producto                 catálogo con la conversación en el centro
 *   /espacio/producto/:sku            ficha de un producto (pestaña Atributos)
 *   /espacio/producto/:sku/:tab       ficha en otra pestaña
 *   /espacio/producto/nuevo[/:tab]    «Nuevo Producto»
 */
export const PRODUCT_BASE_PATH = '/espacio/producto';
/** Segmento reservado para la ficha de un producto nuevo. */
export const NEW_PRODUCT_SEGMENT = 'nuevo';
export const DEFAULT_TAB: PimTabKey = 'atributos';

export interface ProductPathTarget {
  sku?: string | null;
  isNew?: boolean;
  tab?: PimTabKey | null;
}

/** Ruta de una vista del servicio Producto (la pestaña Atributos no se escribe). */
export function productPath({ sku = null, isNew = false, tab = null }: ProductPathTarget = {}): string {
  const segment = isNew ? NEW_PRODUCT_SEGMENT : sku ? encodeURIComponent(sku) : null;
  if (!segment) return PRODUCT_BASE_PATH;
  const suffix = tab && tab !== DEFAULT_TAB ? `/${tab}` : '';
  return `${PRODUCT_BASE_PATH}/${segment}${suffix}`;
}

/** Lee los parámetros de la ruta (useParams): una pestaña desconocida vuelve a Atributos. */
export function parseProductRoute(params: { sku?: string; tab?: string }): ProductRoute {
  const raw = params.sku ?? null;
  const isNew = raw === NEW_PRODUCT_SEGMENT;
  return {
    sku: isNew ? null : raw,
    isNew,
    tab: isPimTabKey(params.tab) ? params.tab : DEFAULT_TAB,
  };
}

/** Clave de la vista para las animaciones y el foco: «none», «new» o el SKU. */
export function sheetKey(route: Pick<ProductRoute, 'sku' | 'isNew'>): string {
  return route.isNew ? 'new' : route.sku ? `sku:${route.sku}` : 'none';
}
