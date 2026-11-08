import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import type { EstudioUploadAsset } from '../api/estudioUploads';
import {
  estudioClipErrorCode, httpEstudioClipClient,
  type ClipAspectRatio, type ClipLatest, type ClipScene, type ClipStatus, type ClipStatusState, type EstudioClipClient,
} from '../api/estudioClip';
import type { EstudioCard, EstudioItem, EstudioSceneState } from '../model/estudioCard';

/**
 * Orquestador del CLIP SIMPLE (motor 090, contrato v1 de SC). Cablea las rutas HTTP detrás de las tarjetas REALES
 * del Estudio (`ConversationEstudioCard`), fiel a la maqueta validada: cotizar («Ver precio») → el botón «Generar»
 * encadena authorize→confirmations (2 actos, 1 clic) → polling de estado («Creando…») → preview («Listo», Drive del
 * cliente). Produce un `EstudioCard` que pinta la tarjeta real; no simula éxito (si el backend no responde bien,
 * falla cerrado). El cliente HTTP es INYECTABLE: la app usa el real, la maqueta/pruebas inyectan un stub del contrato.
 *
 * F11c (29-10): la tarjeta NO vive solo en memoria. Al montar el hilo se consulta `jobs/latest` (ver `useEstudioLatest`)
 * y, si hay un job, el hook se REHIDRATA desde su estado (sin asset): `ready`→preview; en curso→reanuda el polling;
 * `generated_delivery_failed`→tarjeta honesta (el vídeo se generó y se cobró, la entrega está pendiente de recuperar).
 * F10: el polling distingue el fallo SIN gasto (`failed`, «sin coste») de la entrega pendiente/fallida tras cobrar.
 */

// `delivering` (29-10): el backend ya dio `ready` (vídeo adoptado al almacén canónico) pero la entrega PEREZOSA al
// Drive (POST …/preview) aún no ha devuelto un fileId. Honestidad: «Lista» + reproductor SOLO cuando el preview
// confirma el fileId del Drive; mientras tanto se muestra «Guardándose en tu Drive» (nunca «Lista» sin reproductor).
export type ClipPhase = 'quoting' | 'plan' | 'authorizing' | 'creating' | 'delivering' | 'ready' | 'deliveryFailed' | 'error';

export interface ClipParams { aspectRatio: ClipAspectRatio; durationSeconds: number; resolution: string }
export const DEFAULT_CLIP_PARAMS: ClipParams = { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' };

const POLL_MS = 2500;
const MAX_POLLS = 240; // ~10 min; corta por si el estado nunca llega a terminal.
const TITLE = 'Vídeo para la ficha';

/** Estado del backend (inglés) → estado de la UI de la tarjeta. */
export function sceneStateFromStatus(state: ClipStatusState): EstudioSceneState {
  switch (state) {
    case 'queued': return 'enCola';
    case 'creating': return 'creandose';
    case 'ready': return 'lista';
    case 'failed': return 'fallida';
    case 'generated_delivery_pending': return 'entregando';
    case 'generated_delivery_failed': return 'entregaPendiente';
  }
}

function sceneItem(scene: ClipScene, durationSeconds: number): EstudioItem {
  return { index: scene.index, title: scene.title, state: sceneStateFromStatus(scene.state), durationSec: durationSeconds };
}

/** «escena N de M»: N = la mayor escena que ya no está en cola (en creación o lista), mínimo 1. */
function currentScene(scenes: ClipScene[]): number {
  const moved = scenes.filter(s => s.state !== 'queued').map(s => s.index);
  return moved.length ? Math.max(...moved) : 1;
}

/** Plan PROVISIONAL «sin precio» mientras se cotiza (Crear deshabilitado): no inventa cifra. El plan real (con
 *  maxEur + quoteId) llega del `POST /quote` como `estudioCard` y reemplaza a éste. */
function planPlaceholder(threadId: string, params: ClipParams): EstudioCard {
  return {
    kind: 'plan', threadId, title: TITLE,
    meta: { format: 'Vídeo rápido', scenes: 1, durationSec: params.durationSeconds, aspect: params.aspectRatio, resolution: params.resolution, engineLabel: 'Vídeo con IA de Google' },
    scenes: [{ index: 1, title: 'Clip' }],
    maxEur: null,
    payer: 'customer_google_project',
  };
}

function creatingCard(threadId: string, params: ClipParams, status: ClipStatus): EstudioCard {
  const items = status.scenes.map(s => sceneItem(s, params.durationSeconds));
  return {
    kind: 'creating', threadId, title: TITLE,
    meta: { format: 'Vídeo rápido', scenes: items.length || 1, durationSec: params.durationSeconds, aspect: params.aspectRatio, resolution: params.resolution, engineLabel: 'Vídeo con IA de Google' },
    items,
    progress: { current: currentScene(status.scenes), total: status.scenes.length || 1 },
  };
}

function resultCard(threadId: string, params: ClipParams, status: ClipStatus, previewFileId?: string): EstudioCard {
  const items = status.scenes.map(s => sceneItem(s, params.durationSeconds));
  return {
    kind: 'result', threadId, title: TITLE, version: 1,
    meta: { format: 'Vídeo rápido', scenes: items.length || 1, durationSec: params.durationSeconds, aspect: params.aspectRatio, resolution: params.resolution, engineLabel: 'Vídeo con IA de Google' },
    items, previewFileId,
  };
}

function reason(error: unknown): string {
  const code = estudioClipErrorCode(error);
  if (code === 'creative_input_not_owned') return 'No encuentro tu foto. Vuelve a subirla y lo intentamos otra vez.';
  if (code === 'not_authorizable' || code === 'not_confirmable') return 'No se pudo generar esta vez. Vuelve a intentarlo; no se te ha cobrado nada.';
  return errorMessage(error, 'No se pudo generar el clip. Inténtalo de nuevo.');
}

/** Fase inicial al REHIDRATAR desde `jobs/latest` (F11c), sin parpadeo de «plan». `ready` NO arranca en «Lista»:
 *  arranca en `delivering` («Guardándose en tu Drive») y solo pasa a `ready`+reproductor cuando el preview confirma
 *  el fileId del Drive (así nunca se muestra «Lista» sin poder reproducir, ni en el transitorio del montaje). */
function phaseFromLatest(status: ClipStatusState): ClipPhase {
  if (status === 'ready') return 'delivering';
  if (status === 'generated_delivery_failed') return 'deliveryFailed';
  // queued | creating | generated_delivery_pending | failed → tarjeta «creando» (failed = chip «sin coste», terminal).
  return 'creating';
}

function statusOf(latest: ClipLatest): ClipStatus {
  return { jobId: latest.jobId, status: latest.status, scenes: latest.scenes, deliveryReason: latest.deliveryReason };
}

export interface UseEstudioClipArgs {
  threadId: string;
  /** La foto ya subida (owned-input). Sin ella (y sin `resume`) no se cotiza. */
  asset: EstudioUploadAsset | null;
  /** F11c: job existente del hilo (de `jobs/latest`) para REHIDRATAR sin depender del asset en memoria. */
  resume?: ClipLatest | null;
  params?: ClipParams;
  /** Inyectable; por defecto el cliente HTTP real del contrato v1. */
  client?: EstudioClipClient;
}

export interface UseEstudioClipResult {
  phase: ClipPhase;
  card: EstudioCard | null;
  error: string | null;
  /** Código card-safe del backend cuando falla (p. ej. `cloud_not_ready`), o null. Permite a la UI distinguir
   *  estados de borde: si es `cloud_not_ready`, la tarjeta invita a reconectar Google Cloud y reintentar «Animar». */
  errorCode: string | null;
  /** «Generar»: encadena authorize → confirmations y arranca el polling. */
  create: () => void;
  /** Reintenta la cotización. */
  requote: () => void;
  /** Re-sondea el estado del job actual (p. ej. «Comprobar de nuevo» tras `generated_delivery_failed`: el backend
   *  puede haber recuperado la entrega al Drive). */
  recheck: () => void;
}

/** Hook de orquestación. Cotiza al tener la foto (o rehidrata desde `resume`); `create()` autoriza+confirma y hace
 *  polling hasta terminal. */
export function useEstudioClip({ threadId, asset, resume = null, params = DEFAULT_CLIP_PARAMS, client = httpEstudioClipClient }: UseEstudioClipArgs): UseEstudioClipResult {
  const [phase, setPhase] = useState<ClipPhase>(() => resume ? phaseFromLatest(resume.status) : 'quoting');
  const [plan, setPlan] = useState<EstudioCard | null>(null); // el estudioCard kind='plan' que devuelve POST /quote
  const [status, setStatus] = useState<ClipStatus | null>(() => resume ? statusOf(resume) : null);
  const [previewFileId, setPreviewFileId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const stopTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const cleanup = useCallback(() => { stopTimer(); abort.current?.abort(); abort.current = null; }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cleanup(); };
  }, [cleanup]);

  // Preview «Listo»: dispara/confirma la entrega PEREZOSA al Drive y trae el fileId. Solo con fileId pasamos a
  // `ready` (tarjeta «Lista» + reproductor). Si el preview falla (la entrega al Drive aún no está), NO mentimos con
  // «Lista»: pasamos a `delivering` («Guardándose en tu Drive» + «Comprobar de nuevo»). Honra la garantía al dueño.
  const fetchPreview = useCallback((jobId: string, ctrl: AbortController) => {
    client.preview(jobId, ctrl.signal)
      .then(p => { if (alive.current && !ctrl.signal.aborted) { setPreviewFileId(p.fileId); setPhase('ready'); } })
      .catch(() => { if (alive.current && !ctrl.signal.aborted) setPhase('delivering'); });
  }, [client]);

  // Polling del estado del job hasta terminal (sin SSE). Bucle local recursivo para no auto-referenciar un
  // useCallback (react-hooks/immutability) y capturar el `ctrl` de esta ejecución.
  const startPolling = useCallback((jobId: string, ctrl: AbortController) => {
    const pump = (attempt: number) => {
      client.status(threadId, jobId, ctrl.signal)
        .then(s => {
          if (!alive.current || ctrl.signal.aborted) return;
          setStatus(s);
          if (s.status === 'ready') { fetchPreview(jobId, ctrl); return; }
          if (s.status === 'generated_delivery_failed') { setPhase('deliveryFailed'); return; } // generado+cobrado, entrega pendiente de recuperar
          if (s.status === 'failed') { setPhase('creating'); return; } // SOLO pre-POST (0 €): la tarjeta muestra «sin coste»
          // queued | creating | generated_delivery_pending → seguir sondeando (la entrega se recupera sola)
          if (attempt + 1 >= MAX_POLLS) { setError('El clip está tardando más de lo normal. Inténtalo de nuevo más tarde.'); setErrorCode(null); setPhase('error'); return; }
          timer.current = setTimeout(() => pump(attempt + 1), POLL_MS);
        })
        .catch(err => { if (alive.current && !ctrl.signal.aborted) { setError(reason(err)); setErrorCode(estudioClipErrorCode(err)); setPhase('error'); } });
    };
    pump(0);
  }, [client, threadId, fetchPreview]);

  // Lanza la cotización (solo async; el estado se fija en el `.then`, no síncronamente → no setState en el efecto).
  const startQuote = useCallback((ctrl: AbortController) => {
    if (!asset) return;
    client.quote(threadId, { assetId: asset.assetId, ...params }, ctrl.signal)
      .then(card => { if (alive.current && !ctrl.signal.aborted) { setPlan(card); setPhase('plan'); } })
      .catch(err => { if (alive.current && !ctrl.signal.aborted) { setError(reason(err)); setErrorCode(estudioClipErrorCode(err)); setPhase('error'); } });
  }, [asset, client, threadId, params]);

  // REHIDRATAR (F11c): al montar con un job existente, arranca desde su estado sin cotizar. `ready`→preview;
  // en curso (queued/creating/generated_delivery_pending)→reanuda el polling; terminal (deliveryFailed/failed)→
  // ya quedó fijado por el estado inicial perezoso (no sondea).
  useEffect(() => {
    if (!resume) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    if (resume.status === 'ready') fetchPreview(resume.jobId, ctrl);
    else if (resume.status !== 'generated_delivery_failed' && resume.status !== 'failed') startPolling(resume.jobId, ctrl);
    return () => { ctrl.abort(); stopTimer(); };
  }, [resume, fetchPreview, startPolling]);

  // Cotiza al montar / al cambiar la foto (modo fresco, sin resume). Durante la cotización la tarjeta muestra
  // «sin precio» (Crear deshabilitado).
  useEffect(() => {
    if (resume || !asset) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    startQuote(ctrl);
    return () => { ctrl.abort(); stopTimer(); };
  }, [resume, asset, startQuote]);

  // Reintento de la cotización (acción del usuario): reinicia el estado antes de volver a cotizar.
  const requote = useCallback(() => {
    cleanup();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null); setErrorCode(null); setStatus(null); setPreviewFileId(undefined); setPlan(null); setPhase('quoting');
    startQuote(ctrl);
  }, [cleanup, startQuote]);

  // Re-sondea tras una entrega pendiente/fallida (el backend o la entrega perezosa pueden haberse recuperado). No crea
  // ni cobra nada. Si el job YA está adoptado (`ready`), lo único pendiente es la entrega perezosa al Drive → reintenta
  // el preview directamente (sin parpadeo de «Creando»). Si no, re-sondea el estado del job.
  const recheck = useCallback(() => {
    const jobId = status?.jobId;
    if (!jobId) return;
    cleanup();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null); setErrorCode(null);
    if (status?.status === 'ready') { setPhase('delivering'); fetchPreview(jobId, ctrl); }
    else { setPhase('creating'); startPolling(jobId, ctrl); }
  }, [status, cleanup, startPolling, fetchPreview]);

  const create = useCallback(() => {
    if (!asset || !plan?.quoteId) return;
    cleanup();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null); setErrorCode(null); setPhase('authorizing');
    // Body de authorize VACÍO: el backend deriva el request_id del quote_id (Opción A, anti-tamper server-side).
    client.authorize(threadId, plan.quoteId, ctrl.signal)
      .then(a => client.confirm(threadId, a.jobId, a.requestSha256, ctrl.signal).then(() => a.jobId))
      .then(jobId => { if (!alive.current || ctrl.signal.aborted) return; setPhase('creating'); startPolling(jobId, ctrl); })
      .catch(err => { if (!alive.current || ctrl.signal.aborted) return; setError(reason(err)); setErrorCode(estudioClipErrorCode(err)); setPhase('error'); });
  }, [asset, plan, client, threadId, cleanup, startPolling]);

  const card = useMemo<EstudioCard | null>(() => {
    // Mientras se cotiza, plan PROVISIONAL «sin precio»; al llegar el quote, el estudioCard real (con precio + quoteId).
    if (phase === 'quoting') return planPlaceholder(threadId, params);
    if (phase === 'plan' || phase === 'authorizing') return plan ?? planPlaceholder(threadId, params);
    if (phase === 'creating' && status) return creatingCard(threadId, params, status);
    if (phase === 'ready' && status) return resultCard(threadId, params, status, previewFileId);
    return null; // 'delivering', 'deliveryFailed' y 'error' los pinta `EstudioClipFlow` con su propia sección (fuera de la tarjeta aprobada).
  }, [phase, threadId, params, plan, status, previewFileId]);

  return { phase, card, error, errorCode, create, requote, recheck };
}

/** Estados TERMINALES del job (ya no se reanuda el sondeo): entregado, fallo pre-gasto, o entrega fallida. */
const TERMINAL_STATES: ClipStatusState[] = ['ready', 'failed', 'generated_delivery_failed'];
export function isTerminalClipStatus(status: ClipStatusState): boolean {
  return TERMINAL_STATES.includes(status);
}

/**
 * Ventana de recencia para REHIDRATAR un job TERMINAL al montar. Un job EN CURSO (queued/creating/
 * generated_delivery_pending) se reanuda SIEMPRE (no vence). Para el terminal hay dos variantes de experiencia
 * (decisión del DUEÑO, vía Interfaz) y se cambia SOLO esta constante:
 *   - `null`  → Variante A: mostrar siempre el último job terminal (aunque sea antiguo).
 *   - nº ms   → Variante B: mostrar el terminal solo si `createdAt` cae dentro de la ventana (p. ej. 24 h).
 * DEFINITIVO (aprobado por el dueño 29-10-2026): Variante B / 24 h (= 86 400 000 ms).
 */
export const ESTUDIO_RESUME_TERMINAL_MAX_AGE_MS: number | null = 24 * 60 * 60 * 1000;

/**
 * ¿Un clip GENERADO Y COBRADO sin entregar (`generated_delivery_failed`) queda EXENTO de la ventana de recencia
 * (visible SIEMPRE hasta resolverse)? Es dinero del cliente sin entrega: ocultarlo por antigüedad sería deshonesto.
 * DEFINITIVO (aprobado por el dueño 29-10-2026): true. Conmutable con esta constante.
 */
export const ESTUDIO_RESUME_EXEMPT_CHARGED_UNDELIVERED = true;

/** ¿Rehidratar este job al montar, según la política de recencia? EN CURSO: siempre. Entrega fallida tras cobrar
 *  (`generated_delivery_failed`): siempre si `exemptChargedUndelivered` (cargo sin entrega, visible hasta resolverse).
 *  Resto de TERMINALES: siempre si `maxAgeMs` es null; si no, solo cuando `createdAt` cae dentro de la ventana
 *  (createdAt ausente/ilegible = no se rehidrata → subida normal). */
export function shouldResumeLatest(
  job: ClipLatest,
  maxAgeMs: number | null,
  now: number = Date.now(),
  exemptChargedUndelivered: boolean = ESTUDIO_RESUME_EXEMPT_CHARGED_UNDELIVERED,
): boolean {
  if (!isTerminalClipStatus(job.status)) return true;
  if (exemptChargedUndelivered && job.status === 'generated_delivery_failed') return true;
  if (maxAgeMs === null) return true;
  const created = job.createdAt ? Date.parse(job.createdAt) : NaN;
  return Number.isFinite(created) && now - created <= maxAgeMs;
}

export interface UseEstudioLatestResult {
  /** True mientras se consulta `jobs/latest` al montar (el contenedor no decide subida vs rehidratar hasta resolver). */
  checking: boolean;
  /** Job del hilo a rehidratar (ya pasado por la política de recencia), o null si no hay / es terminal antiguo / falló. */
  job: ClipLatest | null;
  /** Olvida el job rehidratado (p. ej. «Empezar otro» → volver a la subida). */
  clear: () => void;
}

/** F11c: al montar el hilo del Estudio, consulta `jobs/latest` (sin depender del asset en memoria). Falla seguro:
 *  cualquier error (incluido 404 = no hay job) deja `job=null` → el contenedor muestra la subida normal. Aplica la
 *  política de recencia (`terminalMaxAgeMs`, por defecto la constante conmutable) a los jobs TERMINALES. */
export function useEstudioLatest(
  threadId: string,
  client: EstudioClipClient = httpEstudioClipClient,
  terminalMaxAgeMs: number | null = ESTUDIO_RESUME_TERMINAL_MAX_AGE_MS,
): UseEstudioLatestResult {
  const [checking, setChecking] = useState(true);
  const [job, setJob] = useState<ClipLatest | null>(null);

  useEffect(() => {
    // `checking` arranca en true (estado inicial); no se re-fija síncronamente aquí (evita renders en cascada). El
    // resultado llega por los callbacks async. El Estudio se monta por hilo, así que threadId es estable en su vida.
    let alive = true;
    const ctrl = new AbortController();
    client.latest(threadId, ctrl.signal)
      .then(j => { if (alive) { setJob(j && shouldResumeLatest(j, terminalMaxAgeMs) ? j : null); setChecking(false); } })
      .catch(() => { if (alive) { setJob(null); setChecking(false); } });
    return () => { alive = false; ctrl.abort(); };
  }, [threadId, client, terminalMaxAgeMs]);

  const clear = useCallback(() => setJob(null), []);
  return { checking, job, clear };
}
