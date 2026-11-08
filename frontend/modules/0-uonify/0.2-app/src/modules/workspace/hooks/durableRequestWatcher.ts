import { getDurableRequest, type DurableRequest } from '../api/durableRequests';
import { ApiError } from '@/shared/api/client';

interface Watch {
  account: string;
  epoch: number;
  requestId: string;
  threadId: string;
  targetRequestId?: string | null;
  valid: () => boolean;
  settled: (result: DurableRequest) => void;
  progressed?: (result: DurableRequest) => void;
  readError?: (error: unknown) => void;
  readRecovered?: () => void;
  /** El servidor ya no muestra este trabajo; nunca equivale a permiso para repetirlo. */
  missing?: () => void;
}

const active = new Map<string, AbortController>();
/** F1-S (lote 8): mientras Uony consulta a Google o escribe, el texto crece sin esperar un segundo entero. */
export const LIVE_TEXT_POLL_MS = 350;
export const DURABLE_READ_INTERRUPTED = 'Seguimos consultando tu petición. Tu trabajo está guardado.';
export const DURABLE_READ_UNAUTHORIZED = 'No podemos consultar esta petición con la sesión actual. Inicia sesión de nuevo; no la enviaremos otra vez.';
export const DURABLE_READ_FORBIDDEN = 'No podemos consultar esta petición con los permisos actuales. Revisa tu acceso; no la enviaremos otra vez.';

export function durableReadStatus(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return DURABLE_READ_UNAUTHORIZED;
  if (error instanceof ApiError && error.status === 403) return DURABLE_READ_FORBIDDEN;
  return DURABLE_READ_INTERRUPTED;
}

export function isDurableReadStatus(status: string): boolean {
  return [DURABLE_READ_INTERRUPTED, DURABLE_READ_UNAUTHORIZED, DURABLE_READ_FORBIDDEN].includes(status);
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Consulta solo lecturas. Ni una pérdida de red ni un 404 autorizan reenviar a Gemini. */
export function watchDurableRequest(watch: Watch): void {
  const key = `${watch.account}:${watch.epoch}:${watch.requestId}`;
  if (active.has(key)) return;
  const controller = new AbortController();
  active.set(key, controller);
  void (async () => {
    let waitMs = 1000;
    let missingReads = 0;
    let readInterrupted = false;
    try {
      while (!controller.signal.aborted && watch.valid()) {
        try {
          const result = await getDurableRequest(watch.requestId, controller.signal);
          if (!watch.valid() || controller.signal.aborted) break;
          if (result.threadId !== watch.threadId) throw new Error('La petición recuperada corresponde a otra conversación.');
          if (watch.targetRequestId !== undefined && (result.targetRequestId ?? null) !== watch.targetRequestId) {
            throw new Error('La consulta recuperada corresponde a otra solicitud.');
          }
          missingReads = 0;
          if (readInterrupted) {
            readInterrupted = false;
            watch.readRecovered?.();
          }
          if (result.status !== 'queued' && result.status !== 'running') {
            watch.settled(result);
            break;
          }
          watch.progressed?.(result);
          waitMs = result.progress?.provisional || result.progress?.stage === 'consulting_google' ? LIVE_TEXT_POLL_MS : 1000;
        } catch (error) {
          if (!watch.valid() || controller.signal.aborted) break;
          if (watch.missing && error instanceof ApiError && [404, 410].includes(error.status)) {
            missingReads = error.status === 404 ? missingReads + 1 : 2;
            if (missingReads >= 2) { watch.missing(); break; }
          } else missingReads = 0;
          readInterrupted = true;
          watch.readError?.(error);
          waitMs = Math.min(waitMs * 2, 10000);
        }
        await pause(waitMs, controller.signal);
      }
    } finally { if (active.get(key) === controller) active.delete(key); }
  })();
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  active.forEach(controller => controller.abort());
  active.clear();
});
