import { ApiError, api } from '@/shared/api/client';
import { PIM_ENDPOINTS } from '@/shared/pim';
import { cell, extractSpecifications, stripHtml } from '../model/text';

/**
 * Contenido con Uony (prototipo: pim/descripciones.js, generateContent;
 * original: services/pim/aiDescriptionsService.ts). Contrato del backend:
 *   POST /ai-descriptions
 *   { product_info: { nombre_producto, descripcion, caracteristicas, categoria, sku, asin, existing_bullets },
 *     field: 'description' | 'keywords' | 'feature-0' … 'feature-5' }
 *   → { description } · { keywords } · { bullets_array: ['• …'] } (o una respuesta Lambda { body: string })
 * Tiempo máximo: 60 s.
 */
export type ContentField = 'description' | 'keywords' | `feature-${number}`;

export interface GeneratedContent {
  description?: unknown;
  keywords?: unknown;
  bullets_array?: unknown[];
  bullet_points?: unknown;
  [field: string]: unknown;
}

const AI_TIMEOUT = 60_000;

export async function generateContent(productData: Record<string, unknown>, field: ContentField): Promise<GeneratedContent> {
  const specs = extractSpecifications(productData);
  const bulletPoints = Array.isArray(productData.bulletPoints) ? productData.bulletPoints : null;
  let caracteristicas: unknown[] = bulletPoints?.filter(bullet => cell(bullet).trim()) || [];
  if (specs.length > 0) caracteristicas = [...caracteristicas, ...specs];
  const productInfo = {
    nombre_producto: productData.name || productData.title || 'Producto sin nombre',
    descripcion: stripHtml(productData.description || productData.body_html || ''),
    caracteristicas,
    categoria: productData.product_type || productData.category,
    sku: productData.sku,
    asin: productData.asin,
    existing_bullets: productData.existing_bullets || [],
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);
  try {
    const data = await api.post<unknown>(PIM_ENDPOINTS.AI_DESCRIPTIONS, { product_info: productInfo, field }, { signal: controller.signal });
    const body = (data as { body?: unknown } | null)?.body;
    return ((typeof body === 'string' ? JSON.parse(body) : data) as GeneratedContent | null) || {};
  } catch (error) {
    const detail = error instanceof ApiError ? (error.data as { error?: unknown } | null)?.error : undefined;
    throw new Error(typeof detail === 'string' && detail ? detail : 'Error al generar contenido', { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
