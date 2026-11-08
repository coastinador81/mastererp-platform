import { api } from '@/shared/api/client';

export type MaterialSupport = 'supported' | 'needs_review' | 'unsupported';
export type MaterialChannel = 'product' | 'production' | 'safety' | 'reference';
export interface MaterialRegion {
  page?: number; frame?: number; asset?: string; bbox: [number, number, number, number];
  coordinateSpace: 'pixels' | 'pdf_points'; width: number; height: number; origin: 'top-left'; dpi?: number;
}
export interface MaterialBarcode { value: string; format: string; structureValid: boolean | null; decoded: boolean; region?: MaterialRegion }
export interface MaterialFormulaEvidence { locator: string; rowLocator: string; formula: string; cachedValue: unknown; cacheStatus: 'cached_unverified' | 'cached_error' | 'missing'; freshness: string; executed: false }
export interface MaterialReadingCoverage {
  complete?: boolean; native?: boolean; hybrid?: boolean; ocr?: boolean | { engine: string; units: number; seconds: number; externalCalls: number; lowConfidenceLines: number };
  pages?: number; regions?: number; ocrRegions?: number; barcodes?: number | MaterialBarcode[];
  visualUnits?: { locator: string; detailRegions?: number; status: string }[]; tables?: { locator: string; rows: number; status: 'read' | 'visual_review'; region?: MaterialRegion }[]; embeddedVisuals?: number;
  scenes?: number; objects?: number; materials?: number; textures?: number; cameras?: number;
  externalTextures?: number; packedTextures?: number; externalLibraries?: number;
  nominalGeometry?: boolean; visualPreviewGenerated?: boolean;
  formulaCells?: number; missingFormulaValues?: number; uncertainFormulaValues?: number; invalidFormulaValues?: number; formulaEvidence?: MaterialFormulaEvidence[];
  archiveEntries?: number | { path: string; status: string; reason?: string }[]; entriesRead?: number; entriesUnsupported?: number; entriesPending?: number;
  [key: string]: unknown;
}
export interface MaterialEvidence {
  sourceId: string; locator: string; excerpt: string;
  citationId?: string; fragmentId?: string; sourceVersion?: string; supportStatus?: MaterialSupport;
  contextEvidence?: MaterialEvidence[]; region?: MaterialRegion; method?: string; confidence?: number;
  observational?: boolean; format?: string; structureValid?: boolean; barcode?: MaterialBarcode; formulaEvidence?: MaterialFormulaEvidence[];
}
export interface MaterialSource {
  id: string; name: string; mimeType: string; status: string; reason?: string; message?: string;
  path?: string; url?: string; warnings?: string[]; summary?: string;
  readerVersion?: string; readingCoverage?: MaterialReadingCoverage; remedy?: string;
  resolutionSummary?: { technicalPendingCount: number; historicalDiscardCount: number };
  excerpts?: { locator: string; text: string }[];
  image?: { width: number; height: number; analysisWidth: number; analysisHeight: number };
}
export interface MaterialProposal {
  id: string; field: string; label: string; value: string; confirmedValue?: string;
  evidence: MaterialEvidence[]; status: 'proposed' | 'confirmed' | 'rejected';
}
export interface MaterialFact extends MaterialProposal {
  canonicalField: string; normalizedValue: string; unit?: string | null; scope: string;
  channel: MaterialChannel; claimType: string; supportStatus: MaterialSupport;
  supportReasons: { code: string; message: string }[]; reviewable: boolean;
  sourceProposalIds: string[]; originalValues: string[]; conflictGroup?: string; conflict?: boolean;
  confirmationOrigin?: 'documentary' | 'user_declared' | 'existing_product'; supportedValue?: boolean;
}
export interface MaterialRejection {
  id: string; label?: string; value?: string; reason?: string; code?: string;
  reasons?: { code: string; message: string }[]; evidence?: MaterialEvidence[];
  recovered?: boolean;
}
export interface MaterialFacts {
  version: number; proposals: MaterialFact[]; rejections: MaterialRejection[];
  summary?: Record<string, unknown>;
  stale?: boolean; historicalRejectionsWithoutCandidate?: number;
}
export interface MaterialResolutionIssue {
  id: string; kind: 'reading' | 'analysis' | 'evidence' | 'client';
  status: 'pending' | 'awaiting_client' | 'awaiting_source' | 'resolved' | 'discarded';
  title: string; detail: string; reason?: string; sourceId?: string; factId?: string;
  action?: 'upgrade_readers' | 'repair_evidence' | 'review' | 'retry' | 'replace_source';
}
export interface MaterialResolution {
  version: 1; processedSources: number; completeSources: number;
  technicalPendingCount: number; clientPendingCount: number; sourcePendingCount?: number;
  discardedProposalCount: number; historicalRejectionCount: number; resolvedCount: number;
  issues: MaterialResolutionIssue[];
}
export interface MaterialAnalysisJob {
  id: string; sku: string; revision: number; status: 'queued' | 'running' | 'paused' | 'ready' | 'error';
  folderId: string; folderName: string; processed: number; total: number;
  sources: MaterialSource[]; proposals: MaterialProposal[]; warnings: string[];
  error?: { code: string; message: string }; usage?: Record<string, unknown>;
  analysisModel?: string; analysisEffort?: string;
  stage?: 'queued' | 'discovering' | 'reading' | 'analyzing' | 'reconciling' | 'paused' | 'ready' | 'error';
  operation?: 'analysis' | 'reconcile' | 'upgrade_readers' | 'repair_evidence';
  readerUpgradeAvailable?: boolean; repairAvailable?: boolean; resolution?: MaterialResolution;
  coverage?: { sourcesTotal: number; sourcesRead: number; fragmentsTotal: number; fragmentsDone: number; fragmentsPending: number; fragmentsPartial?: number; fragmentsNeedingReview?: number };
  budget?: { maxCalls: number; usedCalls: number; maxTokens: number; usedTokens: number; reservedTokens?: number; unknownCalls?: number };
  pauseReason?: string; canResume?: boolean; pauseRequested?: boolean;
  facts?: MaterialFacts;
  reconciliation?: { status: string; checkedSources?: number };
}
export interface ProductMaterials { job: MaterialAnalysisJob | null; product?: { sku: string; revision: number } }
export interface MaterialAnalysisControl { requestId: string; revision: number; acknowledgeUnknownConsumption?: boolean;
  consentVersion?: string; consentText?: string; consentSha256?: string }
export interface MaterialAnalysisStart { requestId: string; revision: number; folderId: string;
  consentVersion?: string; consentText?: string; consentSha256?: string; reanalysisOf?: string }
const base = (sku: string) => `/products/${encodeURIComponent(sku)}/materials`;
export const materialsKey = (account: string, sku: string) => ['product-drive-materials', account, sku] as const;
export const productMaterialsApi = {
  latest: (sku: string, signal?: AbortSignal) => api.get<ProductMaterials>(base(sku), { signal }),
  startConsent: (sku: string, signal?: AbortSignal) => api.get<{ version: string; text: string; sha256: string }>(`${base(sku)}/start-consent`, { signal }),
  controlConsent: (sku: string, id: string, action: 'upgradeReaders' | 'repairEvidence', signal?: AbortSignal) =>
    api.get<{ version: string; text: string; sha256: string }>(`${base(sku)}/jobs/${encodeURIComponent(id)}/control-consent/${action === 'upgradeReaders' ? 'upgrade-readers' : 'repair-evidence'}`, { signal }),
  job: (sku: string, id: string, signal?: AbortSignal) => api.get<{ job: MaterialAnalysisJob }>(`${base(sku)}/jobs/${encodeURIComponent(id)}`, { signal }),
  start: (sku: string, data: MaterialAnalysisStart, signal?: AbortSignal) => api.post<{ job: MaterialAnalysisJob }>(`${base(sku)}/jobs`, data, { signal }),
  startForAssignment: (assignmentId: string, sku: string, data: MaterialAnalysisStart, signal?: AbortSignal) =>
    api.post<{ job: MaterialAnalysisJob; assignmentId: string; assignmentWorkScope: 'started_for_assignment' }>(
      `/uony/assignments/${encodeURIComponent(assignmentId)}/materials/jobs`, { ...data, sku }, { signal }),
  resume: (sku: string, id: string, data: MaterialAnalysisControl, signal?: AbortSignal) => api.post<ProductMaterials>(`${base(sku)}/jobs/${encodeURIComponent(id)}/resume`, data, { signal }),
  pause: (sku: string, id: string, data: MaterialAnalysisControl, signal?: AbortSignal) => api.post<ProductMaterials>(`${base(sku)}/jobs/${encodeURIComponent(id)}/pause`, data, { signal }),
  upgradeReaders: (sku: string, id: string, data: MaterialAnalysisControl, signal?: AbortSignal) => api.post<ProductMaterials>(`${base(sku)}/jobs/${encodeURIComponent(id)}/upgrade-readers`, data, { signal }),
  repairEvidence: (sku: string, id: string, data: MaterialAnalysisControl, signal?: AbortSignal) => api.post<ProductMaterials>(`${base(sku)}/jobs/${encodeURIComponent(id)}/repair-evidence`, data, { signal }),
  reconcile: (sku: string, id: string, data: MaterialAnalysisControl, signal?: AbortSignal) => api.post<ProductMaterials>(`${base(sku)}/jobs/${encodeURIComponent(id)}/reconcile`, data, { signal }),
};
