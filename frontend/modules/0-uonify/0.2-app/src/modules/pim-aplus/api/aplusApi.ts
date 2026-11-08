import { api, ApiError } from '@/shared/api/client';
import { REQUEST_TIMEOUT } from '../model/constants';
import type { AmazonListItem, AmazonMetadataRecord } from '../model/amazonTypes';
import type { GenerateProductInfo } from '../model/ecosystem';
import type { BackendModule } from '../model/types';

/**
 * Servicios A+ (services/apiService.ts 238-317 del original): mismas rutas, métodos,
 * parámetros y cuerpos, bajo API_BASE. Cada petición espera como mucho 300 s.
 * POST /ai-aplus es nuevo: la generación con Uony pasa por el backend.
 */
export const APLUS_ENDPOINTS = {
  list: '/amazon/aplus/list',
  search: '/amazon/aplus/search',
  detail: '/amazon/aplus/detail',
  imageProxy: '/amazon/aplus/image-proxy',
  create: '/amazon/aplus/create',
  update: '/amazon/aplus/update',
  createPublish: '/amazon/aplus/create_publish',
  createLink: '/amazon/aplus/create_link',
  uploadDestination: '/amazon/aplus/upload-destination',
  uploadToS3: '/amazon/aplus/upload-to-s3',
  generate: '/ai-aplus',
} as const;

export interface AsinParams {
  asin: string;
  marketplace_id: string;
}

export interface DetailParams {
  contentReferenceKey: string;
  marketplace_id: string;
}

export interface SavePayload {
  contentReferenceKey?: string;
  asin: string;
  marketplace_id: string;
  country_code: string;
  brand?: string;
  modules: BackendModule[];
}

export interface SaveWarning {
  step?: string;
  message?: string;
  details?: string;
}

export interface SaveResult {
  contentReferenceKey?: string;
  warnings?: SaveWarning[];
}

export type SaveResponse = SaveResult & { body?: SaveResult };

export interface ListResponse {
  filtered?: AmazonListItem[];
}

export interface SearchResponse {
  contentMetadataRecords?: AmazonMetadataRecord[];
  payload?: { contentMetadataRecords?: AmazonMetadataRecord[] };
  body?: { contentMetadataRecords?: AmazonMetadataRecord[] };
}

export interface UploadDestination {
  uploadDestinationId?: string;
  url?: string;
  headers?: Record<string, string>;
}

export type UploadDestinationResponse = UploadDestination & { body?: UploadDestination };

export interface UploadToS3Payload {
  uploadUrl: string;
  fileContent: string;
  contentType: string;
  contentMD5: string;
  headers: Record<string, string>;
}

export interface ImageProxyData {
  image?: string;
  contentType?: string;
}

export type ImageProxyResponse = ImageProxyData & { body?: ImageProxyData };

export interface GeneratePayload {
  module_type: 'text-overlay';
  product: GenerateProductInfo;
  limits: { headline: number; body: number };
}

export interface GenerateResponse {
  headline?: string;
  bodyText?: string;
}

function timeout(): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT) : undefined;
  } catch {
    return undefined; // sin AbortSignal.timeout: sin límite
  }
}

const params = (value: object) => value as Record<string, string>;

export const aplusApi = {
  listAplusDocuments: (query: AsinParams) => api.get<ListResponse>(APLUS_ENDPOINTS.list, { params: params(query), signal: timeout() }),
  searchAplusDocuments: (query: AsinParams) => api.get<SearchResponse>(APLUS_ENDPOINTS.search, { params: params(query), signal: timeout() }),
  getAplusDocumentDetail: (query: DetailParams) => api.get<unknown>(APLUS_ENDPOINTS.detail, { params: params(query), signal: timeout() }),
  createAplusDocument: (data: SavePayload) => api.post<SaveResponse>(APLUS_ENDPOINTS.create, data, { signal: timeout() }),
  createAndLinkAplusDocument: (data: SavePayload) => api.post<SaveResponse>(APLUS_ENDPOINTS.createLink, data, { signal: timeout() }),
  createAndPublishAplusDocument: (data: SavePayload) => api.post<SaveResponse>(APLUS_ENDPOINTS.createPublish, data, { signal: timeout() }),
  updateAplusDocument: (data: SavePayload) => api.put<SaveResponse>(APLUS_ENDPOINTS.update, data, { signal: timeout() }),
  getAplusUploadDestination: (data: { contentType: string; contentMD5: string; marketplace_id: string; country_code: string }) =>
    api.post<UploadDestinationResponse>(APLUS_ENDPOINTS.uploadDestination, data, { signal: timeout() }),
  uploadImageToS3: (data: UploadToS3Payload) => api.post<{ success?: boolean; error?: string }>(APLUS_ENDPOINTS.uploadToS3, data, { signal: timeout() }),
  getAplusImage: (query: { uploadDestinationId: string }) => api.get<ImageProxyResponse>(APLUS_ENDPOINTS.imageProxy, { params: query, signal: timeout() }),
  generateAplusContent: (data: GeneratePayload) => api.post<GenerateResponse>(APLUS_ENDPOINTS.generate, data, { signal: timeout() }),
};

/** Cuerpo de error del backend (error.response.data del original). */
export interface ErrorBody {
  error?: string;
  message?: string;
  details?: unknown;
  body?: { error?: string; message?: string };
}

export function errorBody(error: unknown): ErrorBody {
  if (error instanceof ApiError && error.data && typeof error.data === 'object') return error.data as ErrorBody;
  return {};
}
