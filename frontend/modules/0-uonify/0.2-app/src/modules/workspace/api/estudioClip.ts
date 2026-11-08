import { ApiError, api } from '@/shared/api/client';
import { estudioCardOf, type EstudioCard } from '../model/estudioCard';

/**
 * Contrato HTTP del «clip simple» del Estudio (motor clips-only 090) — FIJADO por Super Computer
 * (v1, 28-10; nota `sc-contrato-http-clip-simple-v1-20261028.md`). El frontend cablea estas 5 rutas; la tool
 * conversacional (reapunte 084→090) la lleva SC. Flujo de la maqueta validada: subir foto → cotizar («Ver precio»)
 * → autorizar+confirmar («Generar», 2 actos tras 1 botón) → estado («Creando…») → preview («Listo», Drive del cliente).
 *
 * AUTH por SESIÓN (cookie HttpOnly) + CSRF por Origin (require_origin). El user NUNCA va en el body; `thread_id`
 * y los ids van en la ruta. Body estricto (rechaza campos extra).
 *
 * CARD-SAFE (D-PROTECCIÓN): € nunca USD; nada de gs://, model-id, project-id ni hashes VISIBLES. `requestSha256`
 * es un TOKEN DE PROTOCOLO que el cliente REENVÍA (authorize/confirm), nunca se muestra.
 *
 * INERTE: las rutas aún no están desplegadas/montadas por completo; esto se activa tras flag del dueño + Consultor/REA.
 * Falla cerrado: si el backend no devuelve una forma válida, no se continúa con algo a medias (no se simula éxito).
 */

// Veo solo soporta 16:9 y 9:16 para vídeo (SC 28-10; 1:1 es para la imagen principal, otro flujo).
export type ClipAspectRatio = '16:9' | '9:16';
/**
 * Estado del job / de la escena que emite el backend (inglés). F10 (contrato SC 29-10, status HONESTO): distingue
 * entre un fallo SIN gasto y un vídeo ya generado+COBRADO cuya entrega al Drive queda pendiente. Se traduce a la UI
 * con `sceneStateFromStatus`.
 * - `queued` / `creating`: en curso (aún no entregado).
 * - `ready`: clip entregado al Drive del cliente.
 * - `failed`: fallo PRE-POST (0 €, nada generado) — el ÚNICO estado «sin coste».
 * - `generated_delivery_pending`: vídeo generado y COBRADO, entrega en curso/reintentable. NUNCA «sin coste».
 * - `generated_delivery_failed`: vídeo generado y COBRADO, la entrega falló (recuperable). NUNCA «sin coste»;
 *   acompaña un `deliveryReason` card-safe (para telemetría; NO se muestra al cliente).
 * Regla dura del backend: si hubo POST (gasto) el estado JAMÁS es `failed`. */
export type ClipStatusState = 'queued' | 'creating' | 'ready' | 'failed' | 'generated_delivery_pending' | 'generated_delivery_failed';

export interface ClipQuoteRequest {
  /** assetId OPACO de la foto ya subida (owned-input). */
  assetId: string;
  aspectRatio: ClipAspectRatio;
  durationSeconds: number;
  resolution: string;
}
export interface ClipAuthorization { jobId: string; requestSha256: string; status: 'queued' }
export interface ClipConfirmation { status: 'confirmed' }
export interface ClipScene { index: number; title: string; state: ClipStatusState }
export interface ClipStatus {
  jobId: string;
  status: ClipStatusState;
  scenes: ClipScene[];
  /** Motivo card-safe del fallo de entrega (p. ej. `veo_poll_name_mismatch:...`) en `generated_delivery_failed`.
   *  Es para telemetría/soporte; NUNCA se muestra al cliente (D-PROTECCIÓN). */
  deliveryReason?: string;
}
/**
 * F11a (contrato SC 29-10): último job del hilo, para REHIDRATAR la tarjeta al montar el Estudio SIN depender del
 * asset en memoria (tras recargar, el job vive y la tarjeta se recupera). Mismo gate card-safe que status; 404 = no
 * hay job en el hilo. `createdAt` ISO opcional (no se muestra). */
export interface ClipLatest extends ClipStatus { createdAt?: string }
export interface ClipPreview { fileId: string }

/**
 * Hilo DEDICADO del clip — CONTRATO B de SC (28-10; modelo de hilo = dedicado, decisión del dueño). El clip NO opera
 * sobre el hilo del chat sino sobre uno propio = `estudio-clip:<chatThreadId>`. El frontend lo COMPONE y lo pasa como
 * `thread_id` a /quote y /authorize (/confirm /status); el backend FALLA-CERRADO con 400 si el hilo no empieza por este
 * prefijo. La tarjeta que devuelve /quote ya trae `threadId` = el dedicado. El draft fantasma del chat desaparece.
 *
 * CONDICIÓN DURA (garantía del frontend): ningún id de hilo del CHAT empieza por este prefijo — `newThreadId()` siempre
 * emite «thread-…» (verificado en pruebas). El `threadId` de onboarding (`FirstIntentDelivery`) lo asigna el backend;
 * esa mitad de la invariante la garantiza SC. Idempotente: no re-prefija un hilo ya dedicado.
 */
export const ESTUDIO_CLIP_THREAD_PREFIX = 'estudio-clip:';
export function estudioClipThreadId(chatThreadId: string): string {
  return chatThreadId.startsWith(ESTUDIO_CLIP_THREAD_PREFIX) ? chatThreadId : `${ESTUDIO_CLIP_THREAD_PREFIX}${chatThreadId}`;
}

const base = (threadId: string) => `/uony/threads/${encodeURIComponent(threadId)}/creative-clips`;

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const STATES: ClipStatusState[] = ['queued', 'creating', 'ready', 'failed', 'generated_delivery_pending', 'generated_delivery_failed'];

function bad(data: unknown): ApiError {
  return new ApiError(502, data, 'El Estudio devolvió una respuesta inesperada. Inténtalo de nuevo.');
}

/** Valida la forma card-safe de un estado de job (compartida por `status` y `latest`). */
function isClipStatus(s: unknown): s is ClipStatus {
  const v = s as Partial<ClipStatus> | null;
  if (!v || !text(v.jobId) || !STATES.includes(v.status as ClipStatusState) || !Array.isArray(v.scenes)) return false;
  for (const scene of v.scenes) {
    if (typeof scene?.index !== 'number' || !text(scene.title) || !STATES.includes(scene.state)) return false;
  }
  return v.deliveryReason === undefined || text(v.deliveryReason);
}

/** 1) POST .../quote — «Ver precio». Devuelve un `estudioCard` kind='plan'. No crea job ni gasta. OJO: el estado
 *  legítimo «sin precio» (rates vacías / backend inerte) llega como plan con `maxEur`=null y `quoteId`=null —NO es un
 *  error—: la tarjeta lo pinta «sin precio» con Crear deshabilitado. Solo se rechaza una forma que NO sea un plan. */
export async function quoteClip(threadId: string, req: ClipQuoteRequest, signal?: AbortSignal): Promise<EstudioCard> {
  const resp = await api.post<unknown>(`${base(threadId)}/quote`, req, { signal });
  // Se valida con el MISMO guard card-safe de las tarjetas (role='assistant' solo para satisfacer la firma).
  const card = estudioCardOf(resp, 'assistant');
  if (!card || card.kind !== 'plan') throw bad(resp);
  return card;
}

/** 2) POST .../quotes/{quoteId}/authorize — «Generar» acto 1 (crea el job; no gasta). Body VACÍO: el backend
 *  deriva el request_id del quote_id del PATH (Opción A, anti-tamper server-side). */
export async function authorizeClip(threadId: string, quoteId: string, signal?: AbortSignal): Promise<ClipAuthorization> {
  const a = await api.post<ClipAuthorization>(`${base(threadId)}/quotes/${encodeURIComponent(quoteId)}/authorize`, {}, { signal });
  if (!a || !text(a.jobId) || !text(a.requestSha256) || a.status !== 'queued') throw bad(a);
  return a;
}

/** 3) POST .../confirmations — «Generar» acto 2 (abre el gasto; «una confirmación = un clip»). */
export async function confirmClip(threadId: string, jobId: string, requestSha256: string, signal?: AbortSignal): Promise<ClipConfirmation> {
  const c = await api.post<ClipConfirmation>(`${base(threadId)}/confirmations`, { jobId, requestSha256 }, { signal });
  if (!c || c.status !== 'confirmed') throw bad(c);
  return c;
}

/** 4) GET .../jobs/{jobId}/status — «Creando…» / «Listo» / entrega (polling; sin SSE). */
export async function clipStatus(threadId: string, jobId: string, signal?: AbortSignal): Promise<ClipStatus> {
  const s = await api.get<ClipStatus>(`${base(threadId)}/jobs/${encodeURIComponent(jobId)}/status`, { signal });
  if (!isClipStatus(s)) throw bad(s);
  return s;
}

/** 4b) GET .../jobs/latest — F11a/F11c: el ÚLTIMO job del hilo para REHIDRATAR la tarjeta al montar, sin depender
 *  del asset en memoria. Pide `?include=terminal` para recuperar también `ready`/`failed`/entrega. 404 = no hay job
 *  en el hilo → devuelve `null` (el contenedor muestra la subida normal). No crea nada ni gasta. */
export async function clipLatest(threadId: string, signal?: AbortSignal): Promise<ClipLatest | null> {
  try {
    const s = await api.get<ClipLatest>(`${base(threadId)}/jobs/latest`, { params: { include: 'terminal' }, signal });
    if (!isClipStatus(s) || ((s as ClipLatest).createdAt !== undefined && !text((s as ClipLatest).createdAt))) throw bad(s);
    return s as ClipLatest;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** 5) POST /api/uony/estudio/clips/{jobId}/preview — «Listo» (reproductor nativo en el Drive del cliente). */
export async function clipPreview(jobId: string, signal?: AbortSignal): Promise<ClipPreview> {
  const p = await api.post<ClipPreview>(`/uony/estudio/clips/${encodeURIComponent(jobId)}/preview`, undefined, { signal });
  if (!p || !text(p.fileId)) throw bad(p);
  return p;
}

/** Código de error card-safe del backend (409 `creative_input_not_owned`, 400 `not_authorizable`/`not_confirmable`, etc.). */
export function estudioClipErrorCode(error: unknown): string | null {
  if (error instanceof ApiError) {
    const data = error.data as { error?: unknown } | null;
    if (data && typeof data.error === 'string') return data.error;
  }
  return null;
}

/** Puerto inyectable: la app usa las rutas HTTP reales; la maqueta/pruebas inyectan un stub con respuestas del contrato. */
export interface EstudioClipClient {
  quote(threadId: string, req: ClipQuoteRequest, signal?: AbortSignal): Promise<EstudioCard>;
  authorize(threadId: string, quoteId: string, signal?: AbortSignal): Promise<ClipAuthorization>;
  confirm(threadId: string, jobId: string, requestSha256: string, signal?: AbortSignal): Promise<ClipConfirmation>;
  status(threadId: string, jobId: string, signal?: AbortSignal): Promise<ClipStatus>;
  /** F11c: último job del hilo para rehidratar al montar (null = no hay job). */
  latest(threadId: string, signal?: AbortSignal): Promise<ClipLatest | null>;
  preview(jobId: string, signal?: AbortSignal): Promise<ClipPreview>;
}

/** Cliente REAL (rutas HTTP del contrato v1). */
export const httpEstudioClipClient: EstudioClipClient = {
  quote: quoteClip,
  authorize: authorizeClip,
  confirm: confirmClip,
  status: clipStatus,
  latest: clipLatest,
  preview: clipPreview,
};
