/**
 * Tarjeta del Estudio en el chat (dato de cara al cliente, «card-safe»): la que
 * el backend adjunta a un turno del asistente para que el frontend pinte las
 * tarjetas creativas (plan, creándose, resultado, imágenes, publicar). NUNCA
 * lleva USD, ids de proyecto/modelo crudos, hashes ni gs:// (D-PROTECCION-
 * INGENIERIA-INVERSA): el precio ya viene como «máximo ≈ €» o null. El guard
 * descarta cualquier forma inesperada; hasta que el backend la envíe, no se
 * pinta ninguna tarjeta (no se simula éxito).
 */
export type EstudioCardKind = 'plan' | 'creating' | 'result' | 'images' | 'publish';
export type EstudioTagType = 'persona' | 'producto' | 'lugar' | 'estilo';
// `entregando`/`entregaPendiente` (F10, 29-10): el vídeo ya está GENERADO y COBRADO y lo que queda es la entrega al
// Drive (en curso / pendiente de recuperar). NUNCA «sin coste» (ese rótulo es solo de `fallida`, fallo pre-gasto).
export type EstudioSceneState = 'enCola' | 'creandose' | 'lista' | 'fallida' | 'incierta' | 'entregando' | 'entregaPendiente';

export interface EstudioTag { type: EstudioTagType; label: string }
export interface EstudioScene { index: number; title: string; subtitle?: string; tags?: EstudioTag[] }
export interface EstudioItem { index: number; title: string; subtitle?: string; state: EstudioSceneState; durationSec?: number; posterUrl?: string; playUrl?: string }
export interface EstudioImage { id: string; label: string; selected?: boolean; url?: string; previewUrl?: string }
export interface EstudioMeta { format?: string; scenes?: number; durationSec?: number; aspect?: string; resolution?: string; engineLabel: string }
export interface EstudioPublishTarget { label: string; detail: string }

export interface EstudioCard {
  kind: EstudioCardKind;
  threadId: string;
  title: string;
  version?: number;
  meta?: EstudioMeta;
  scenes?: EstudioScene[];
  items?: EstudioItem[];
  progress?: { current: number; total: number };
  maxEur?: string | null;
  payer?: 'customer_google_project';
  /** Token de protocolo para authorize (nunca se muestra). `null`/ausente = estado «sin precio» (no hay cotización
   *  todavía: rates vacías) → la tarjeta pinta «sin precio» y Crear queda deshabilitado. */
  quoteId?: string | null;
  images?: EstudioImage[];
  imageMeta?: EstudioMeta;
  publishTarget?: EstudioPublishTarget;
  downloadUrl?: string;
  /** id OPACO del fichero en el Drive del cliente para el preview nativo (clip 090); nunca una url cruda. */
  previewFileId?: string;
}

const KINDS: EstudioCardKind[] = ['plan', 'creating', 'result', 'images', 'publish'];
const TAG_TYPES: EstudioTagType[] = ['persona', 'producto', 'lugar', 'estilo'];
const STATES: EstudioSceneState[] = ['enCola', 'creandose', 'lista', 'fallida', 'incierta', 'entregando', 'entregaPendiente'];

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= max;
const index = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 999;
const duration = (value: unknown): boolean =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3600);
// Solo URLs http(s): nunca javascript:, data: ni esquemas raros.
const url = (value: unknown): boolean =>
  value === undefined || (typeof value === 'string' && /^https?:\/\//i.test(value) && value.length <= 2048);
const money = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && /^\d{1,6}([.,]\d{1,2})?$/.test(value));
// fileId de Drive: token opaco [A-Za-z0-9_-], nunca una url ni un gs://.
const fileId = (value: unknown): boolean =>
  value === undefined || (typeof value === 'string' && /^[A-Za-z0-9_-]{10,128}$/.test(value));

function okTag(value: unknown): boolean {
  return record(value) && (TAG_TYPES as string[]).includes(String(value.type)) && text(value.label, 80);
}
function okMeta(value: unknown): boolean {
  if (!record(value) || !text(value.engineLabel, 80)) return false;
  return [value.format, value.aspect, value.resolution].every(v => v === undefined || text(v, 40))
    && (value.scenes === undefined || index(value.scenes)) && duration(value.durationSec);
}
function okScene(value: unknown): boolean {
  if (!record(value) || !index(value.index) || !text(value.title, 120)) return false;
  if (value.subtitle !== undefined && !text(value.subtitle, 200)) return false;
  return value.tags === undefined || (Array.isArray(value.tags) && value.tags.length <= 8 && value.tags.every(okTag));
}
function okItem(value: unknown): boolean {
  return record(value) && index(value.index) && text(value.title, 120)
    && (value.subtitle === undefined || text(value.subtitle, 200))
    && (STATES as string[]).includes(String(value.state))
    && duration(value.durationSec) && url(value.posterUrl) && url(value.playUrl);
}
function okImage(value: unknown): boolean {
  return record(value) && text(value.id, 120) && text(value.label, 120)
    && (value.selected === undefined || typeof value.selected === 'boolean')
    && url(value.url) && url(value.previewUrl);
}

/** url del preview NATIVO de Drive del cliente a partir del fileId OPACO (card-safe; no se guarda la url). */
export function drivePreviewUrl(id: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
}

/** url de la VISTA del archivo en Drive, derivada del mismo fileId OPACO (ya está en el DOM en el preview, no filtra
 *  nada nuevo). Es el APAÑO de descarga mientras el backend no manda un downloadUrl real: el enlace directo
 *  `uc?export=download` fuerza `authuser=0` (cuenta por defecto del navegador) y da 403 cuando el clip vive en el
 *  Drive de OTRA cuenta (p.ej. la cuenta piloto) y es app-owned. `/view` NO fija authuser: Google resuelve la cuenta
 *  y, si hace falta, ofrece cambiarla; el cliente aterriza en Drive y descarga desde ahí. Cuando el backend mande un
 *  `downloadUrl` real (signed URL de GCS con Content-Disposition: attachment), ese prevalece y da descarga 1-clic. */
export function driveFileViewUrl(id: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

/** Lee la tarjeta del Estudio de un turno del asistente, o undefined si no es válida. */
export function estudioCardOf(value: unknown, role: unknown): EstudioCard | undefined {
  if (role !== 'assistant' || !record(value)) return undefined;
  if (!(KINDS as string[]).includes(String(value.kind)) || !text(value.threadId, 120) || !text(value.title, 160)) return undefined;
  if (value.version !== undefined && !index(value.version)) return undefined;
  if (value.meta !== undefined && !okMeta(value.meta)) return undefined;
  if (value.imageMeta !== undefined && !okMeta(value.imageMeta)) return undefined;
  if (value.scenes !== undefined && !(Array.isArray(value.scenes) && value.scenes.length <= 20 && value.scenes.every(okScene))) return undefined;
  if (value.items !== undefined && !(Array.isArray(value.items) && value.items.length <= 20 && value.items.every(okItem))) return undefined;
  if (value.images !== undefined && !(Array.isArray(value.images) && value.images.length <= 8 && value.images.every(okImage))) return undefined;
  if (value.progress !== undefined && !(record(value.progress) && index(value.progress.current) && index(value.progress.total))) return undefined;
  if (!money(value.maxEur)) return undefined;
  if (value.payer !== undefined && value.payer !== 'customer_google_project') return undefined;
  if (value.quoteId !== undefined && value.quoteId !== null && !text(value.quoteId, 120)) return undefined;
  if (value.publishTarget !== undefined && !(record(value.publishTarget) && text(value.publishTarget.label, 160) && text(value.publishTarget.detail, 200))) return undefined;
  if (!url(value.downloadUrl)) return undefined;
  if (!fileId(value.previewFileId)) return undefined;
  return value as unknown as EstudioCard;
}
