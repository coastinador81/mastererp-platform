/**
 * Rutas de los servicios de la ficha (prototipo: pim/core.js, api.config.ENDPOINTS).
 * En el prototipo cada servicio tenía su base (SHOPIFY_BACKEND, AI_AUDIT_BACKEND…),
 * todas iguales; aquí todas van bajo API_BASE con @/shared/api/client:
 *   api.get(PIM_ENDPOINTS.SHOPIFY_PRODUCTS)  →  GET /api/shopify/products
 */
export const PIM_ENDPOINTS = {
  SHOPIFY_PRODUCTS: '/shopify/products',
  AMAZON_PRODUCTS: '/amazon/products/all',
  AMAZON_LISTINGS: '/amazon/listings',
  IMG_3D_UPLOAD: '/img-3d/upload',
  IMG_3D_DOWNLOAD: '/img-3d/download',
  IMG_3D_LIST: '/img-3d',
  AI_DESCRIPTIONS: '/ai-descriptions',
  AI_AUDIT: '/ai-audit',
  AI_BULLET_POINT: '/bullet-point',
  /** Búsqueda de categorías de Amazon (ctx.categorySearch en app-shell.js). */
  AMAZON_PRODUCT_TYPES_SEARCH: '/amazon/product-types/search',
} as const;

export type PimEndpoint = (typeof PIM_ENDPOINTS)[keyof typeof PIM_ENDPOINTS];

/** Tiempo máximo de una petición de los servicios de la ficha (10 min, como el prototipo). */
export const PIM_REQUEST_TIMEOUT = 600_000;

/** Marketplace y país por defecto (Amazon.es), los de api.config del prototipo. */
export { MARKETPLACE } from '@/shared/api/config';
