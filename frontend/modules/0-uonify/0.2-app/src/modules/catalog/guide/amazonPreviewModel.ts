import type { CatalogProduct } from '../model/types';
export interface PreviewImage { id: string; url: string; name: string }
export interface PreviewVideo { id: string; url: string; poster?: string; title?: string }
export interface PreviewAttribute { name: string; value: string }
export function productAttributes(product: CatalogProduct): PreviewAttribute[] {
  const custom = Array.isArray(product.customFields) ? product.customFields as { name?: string; value?: unknown }[] : [];
  return [
    ...(product.brand ? [{ name: 'Marca', value: String(product.brand) }] : []),
    ...custom.filter(field => field.name && field.value !== undefined && field.value !== '').map(field => ({
      name: field.name!, value: typeof field.value === 'boolean' ? field.value ? 'Sí' : 'No' : String(field.value),
    })),
  ];
}
export function previewPrice(value: unknown): { whole: string; fraction: string; label: string } | null {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) return null;
  const parts = amount.toFixed(2).split('.');
  return { whole: Number(parts[0]).toLocaleString('es-ES'), fraction: parts[1], label: amount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }) };
}
