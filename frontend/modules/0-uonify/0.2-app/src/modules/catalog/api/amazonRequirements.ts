import { api } from '@/shared/api/client';
import type { ConversationField } from '@/modules/workspace';
import type { CatalogProduct } from '../model/types';

export interface AmazonRequirementField extends ConversationField {
  suggestion?: { value: string; source: string };
}
export interface AmazonReasoning {
  id: string | null;
  status: 'queued' | 'running' | 'completed' | 'error' | 'unknown' | 'stale';
  message: string;
  canRetry?: boolean;
  requiresConsumptionAcknowledgement?: boolean;
  materialsPending?: boolean;
  requiresPreparation?: boolean;
}
export interface AmazonRequirements {
  product: CatalogProduct;
  evaluation: {
    state: 'unconfigured' | 'needs_input' | 'locally_valid' | 'needs_review' | 'stale' | 'reasoning';
    reasoning?: AmazonReasoning;
    evaluationId: string | null;
    productType: string | null;
    marketplaceId: string;
    referenceAsin: string | null;
    schemaVersion: string | null;
    schemaChecksum: string | null;
    evaluatedAt: string | null;
    counts: { missing: number; invalid: number; questions: number };
    fields: AmazonRequirementField[];
    attributes: { id: string; label: string; required: boolean; present: boolean; valid: boolean }[];
    issues: { path: string; rule: string; message: string }[];
    message: string;
    localOnly: true;
  };
}
export interface AmazonRequirementsSource {
  revision: number; productType?: string; referenceAsin?: string; marketplaceId?: string;
}
export interface AmazonRequirementsAnswers {
  revision: number; evaluationId: string; answers: Record<string, string>; attribute?: string;
}
export interface AmazonRequirementsPreparation { revision: number; retry?: boolean; acknowledgeUnknown?: boolean }
const path = (sku: string) => `/products/${encodeURIComponent(sku)}/amazon-requirements`;
export const amazonRequirementsKey = (account: string, sku: string) => ['catalog', 'amazon-requirements', account, sku] as const;
export const getAmazonRequirements = (sku: string, signal?: AbortSignal, attribute?: string) => api.get<AmazonRequirements>(path(sku), { signal, ...(attribute ? { params: { attribute } } : {}) });
export const configureAmazonRequirements = (sku: string, body: AmazonRequirementsSource, signal?: AbortSignal) => api.post<AmazonRequirements>(path(sku), body, { signal });
export const saveAmazonRequirements = (sku: string, body: AmazonRequirementsAnswers, signal?: AbortSignal) => api.patch<AmazonRequirements>(path(sku), body, { signal });
export const prepareAmazonRequirements = (sku: string, body: AmazonRequirementsPreparation, signal?: AbortSignal) => api.post<AmazonRequirements>(`${path(sku)}/prepare`, body, { signal });
