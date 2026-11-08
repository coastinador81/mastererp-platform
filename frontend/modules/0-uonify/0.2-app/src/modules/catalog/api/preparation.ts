import { api } from '@/shared/api/client';
import type { PimTabKey } from '@/shared/pim';
import type { CatalogProduct } from '../model/types';

export interface PreparationField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  required: boolean;
  options?: string[];
  value: string;
}
export interface PreparationSection {
  id: PimTabKey;
  label: string;
  kind: 'product-fields' | 'planning' | 'local3d';
  state: 'pending' | 'saved' | 'reviewed';
  notice: string;
  fields: PreparationField[];
}
export interface ProductPreparation {
  product: CatalogProduct;
  preparation: {
    mode: null | 'guided' | 'manual';
    activeSection: PimTabKey;
    briefReady: boolean;
    sections: PreparationSection[];
  };
}
export interface PreparationUpdate {
  revision: number;
  mode?: 'guided' | 'manual';
  section?: PimTabKey;
  answers?: Record<string, string>;
  reviewed?: boolean;
  advance?: boolean;
}
const path = (sku: string) => `/products/${encodeURIComponent(sku)}/preparation`;
export const preparationKey = (account: string, sku: string) => ['catalog', 'preparation', account, sku] as const;
export const getProductPreparation = (sku: string, signal?: AbortSignal) => api.get<ProductPreparation>(path(sku), { signal });
export const updateProductPreparation = (sku: string, update: PreparationUpdate, signal?: AbortSignal) => api.patch<ProductPreparation>(path(sku), update, { signal });
