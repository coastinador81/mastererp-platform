import { api } from '@/shared/api/client';
import { MARKETPLACE } from '@/shared/api/config';
import { PATHS } from '../model/constants';
import { isRemote } from '../model/format';
import type { Destination, VideoFormat } from '../model/types';

/**
 * Llamadas del servicio de vídeo (contrato del backend; rutas del prototipo bajo API_BASE).
 * Los proveedores de IA (Veo, OpenAI) los llama el servidor: el navegador nunca
 * guarda sus claves. Los archivos viajan como URL, nunca dentro de un JSON.
 *
 * - GET  /billing/balance                         → { amount, currency }
 * - POST /video/plans                             → { plan: { shots[], closing } }
 * - POST /video/projects                          → { project }
 * - GET  /video/projects/{id}                     → { project }
 * - POST /video/projects/{id}/shots/{plano}/retry → { project }
 * - POST /video/downloads                         → { url, file_name } (402 plan_required en Gratis)
 * - POST /uploads                                 → { upload_url, url } (URL firmada)
 * - GET  /amazon/ads/connection                   → { connected, account }
 * - POST /amazon/ads/assets                       → { asset_id, status } (409 sin Amazon Ads)
 */

export interface BalanceResponse {
  amount?: number | null;
  balance?: number | null;
  currency?: string;
}

export const getBalance = () => api.get<BalanceResponse>(PATHS.balance);

export interface PlanRequest {
  sku: string | null;
  destination: Destination;
  format: VideoFormat;
  language: string;
  product: { name: string; brand: string; category: string; description: string; bullets: unknown[]; keywords: string };
  images: { id: string; name: string; width: number; height: number; source: string; url: string | null }[];
}

export const proposePlan = (body: PlanRequest) => api.post<unknown>(PATHS.plans, body);

export interface ShotPayload {
  id: string;
  position: number;
  image_url: string;
  image_name: string;
  action: string;
  camera: string;
  text: string;
  start: number;
  end: number;
}

export interface ProjectRequest {
  sku: string;
  marketplace_id: string;
  country_code: string;
  destination: Destination;
  format: VideoFormat;
  audio: boolean;
  resolution: '1080p';
  shot_seconds: number;
  final_seconds: number;
  terms_version: string;
  terms_accepted_at: string;
  product: { name: string; brand: string };
  shots: ShotPayload[];
  closing: { tagline: string; brand: string; start: number; end: number };
}

export const createProject = (body: Omit<ProjectRequest, 'marketplace_id' | 'country_code'>) =>
  api.post<unknown>(PATHS.projects, { ...body, marketplace_id: MARKETPLACE.id, country_code: MARKETPLACE.countryCode });

export const getProject = (id: string) => api.get<unknown>(`${PATHS.projects}/${encodeURIComponent(id)}`);

export const retryShot = (projectId: string, shotId: string, body: { shot: ShotPayload; audio: boolean }) =>
  api.post<unknown>(`${PATHS.projects}/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/retry`, body);

export interface AdsAssetRequest {
  sku: string;
  name: string;
  file_name: string;
  content_type: string;
  file_size: number;
  duration: number;
  width: number;
  height: number;
  video_url: string;
}

export const sendAdsAsset = (body: AdsAssetRequest) =>
  api.post<{ asset_id?: string; status?: string }>(PATHS.adsAssets, { ...body, marketplace_id: MARKETPLACE.id, country_code: MARKETPLACE.countryCode });

export interface AdsConnectionResponse {
  connected?: boolean;
  /** Cuenta de anunciante conectada (nombre visible), si la hay. */
  account?: { name?: string; profile_id?: string } | null;
}

export const getAdsConnection = () =>
  api.get<AdsConnectionResponse>(PATHS.adsConnection, { params: { marketplace_id: MARKETPLACE.id, country_code: MARKETPLACE.countryCode } });

/** Para qué se descarga: la ficha (Seller Central), el anuncio (Amazon Ads) o una copia. */
export type DownloadPurpose = 'listing' | 'amazon_ads' | 'copy';

export interface DownloadRequest {
  sku: string;
  video_id: string;
  file_name: string;
  content_type: string;
  /** URL del vídeo; una blob:/data: solo existe en el navegador (el servidor solo autoriza). */
  video_url: string;
  purpose: DownloadPurpose;
}

/**
 * Autoriza una descarga (el plan Gratis no descarga contenido: 402 plan_required, y el
 * cliente HTTP avisa a billing). Devuelve la URL firmada y el nombre del archivo; sin
 * URL, se descarga la copia que ya tiene el navegador.
 */
export const authorizeDownload = (body: DownloadRequest) =>
  api.post<{ url?: string | null; file_name?: string; expires_in?: number }>(PATHS.downloads, body);

/**
 * Subida de un archivo que solo existe en el navegador (data:, blob:): el servidor da
 * una URL firmada (POST /uploads), se sube el archivo y queda su URL pública.
 * La subida va directa al almacenamiento firmado (fetch sin la cookie de sesión).
 */
export async function uploadFile(url: string, name: string, type?: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  const contentType = type || blob.type;
  const data = await api.post<{ upload_url?: string; url?: string }>(PATHS.uploads, { file_name: name, content_type: contentType, size: blob.size });
  if (!data?.upload_url || !isRemote(data?.url)) throw new Error('No se pudo preparar la subida del archivo.');
  const response = await fetch(data.upload_url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob });
  if (!response.ok) throw new Error('No se pudo subir el archivo.');
  return String(data.url);
}
