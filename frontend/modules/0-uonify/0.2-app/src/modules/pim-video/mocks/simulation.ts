import { SAMPLE_VIDEO, SHOT_PRICE } from './fixtures/sampleVideo';

/**
 * Simulación del servidor de vídeo (pura, sin MSW, para poder probarla): un vídeo
 * avanza con el tiempo En cola → Generando los planos (uno a uno) → Montando el
 * vídeo → Listo, y «Rehacer plano» repite el ciclo para ese plano con una versión
 * nueva del resultado. El saldo se descuenta al terminar, por plano generado.
 */

export const QUEUE_MS = 3000;
export const SHOT_MS = 5000;
export const EDIT_MS = 5000;
export const RETRY_SHOT_MS = 6000;

export interface SimShot {
  id: string;
}

export interface SimRetry {
  shotId: string;
  startedAt: number;
}

/** Lo que guarda la «base de datos» de la simulación por vídeo. */
export interface SimProject {
  id: string;
  createdAt: number;
  sku: string;
  destination: 'listing' | 'ads';
  format: '16:9' | '9:16';
  audio: boolean;
  shots: SimShot[];
  retries: SimRetry[];
}

export const shotPrice = (audio: boolean): number => (audio ? SHOT_PRICE.audio : SHOT_PRICE.silent);
const round = (value: number) => Math.round(value * 100) / 100;

/** Momento en que termina la generación inicial. */
export const firstDoneAt = (sim: SimProject): number => sim.createdAt + QUEUE_MS + sim.shots.length * SHOT_MS + EDIT_MS;
/** Momento en que termina un «Rehacer plano». */
export const retryDoneAt = (retry: SimRetry): number => retry.startedAt + RETRY_SHOT_MS + EDIT_MS;

/** Coste de generar el vídeo entero. */
export const projectCost = (shots: number, audio: boolean): number => round(shots * shotPrice(audio));

/** Saldo descontado hasta `now` por un vídeo (inicial + planos rehechos ya terminados). */
export function spentBy(sim: SimProject, now: number): number {
  let spent = now >= firstDoneAt(sim) ? projectCost(sim.shots.length, sim.audio) : 0;
  sim.retries.forEach(retry => { if (now >= retryDoneAt(retry)) spent += shotPrice(sim.audio); });
  return round(spent);
}

type ShotStatus = 'queued' | 'generating' | 'done';

function shotsAt(sim: SimProject, now: number, retry: SimRetry | null): { id: string; status: ShotStatus }[] {
  if (retry) {
    const busy = now < retry.startedAt + RETRY_SHOT_MS;
    return sim.shots.map(shot => ({ id: shot.id, status: busy && shot.id === retry.shotId ? 'generating' : 'done' }));
  }
  const elapsed = now - sim.createdAt;
  if (elapsed < QUEUE_MS) return sim.shots.map(shot => ({ id: shot.id, status: 'queued' }));
  const finished = Math.floor((elapsed - QUEUE_MS) / SHOT_MS);
  return sim.shots.map((shot, index) => ({ id: shot.id, status: index < finished ? 'done' : 'generating' }));
}

/** Estado del vídeo en `now`, con el formato de GET /video/projects/{id}. */
export function projectAt(sim: SimProject, now: number) {
  const latest = sim.retries[sim.retries.length - 1] || null;
  const activeRetry = latest && now < retryDoneAt(latest) ? latest : null;
  const finishedRetries = sim.retries.filter(retry => now >= retryDoneAt(retry)).length;
  const firstDone = now >= firstDoneAt(sim);
  let status: 'queued' | 'generating' | 'editing' | 'done';
  if (activeRetry) status = now < activeRetry.startedAt + RETRY_SHOT_MS ? 'generating' : 'editing';
  else if (firstDone) status = 'done';
  else {
    const elapsed = now - sim.createdAt;
    status = elapsed < QUEUE_MS ? 'queued' : elapsed < QUEUE_MS + sim.shots.length * SHOT_MS ? 'generating' : 'editing';
  }
  const shots = shotsAt(sim, now, activeRetry);
  // Mientras se rehace un plano, el resultado anterior sigue disponible.
  const version = 1 + finishedRetries;
  const hasResult = firstDone;
  const charged = finishedRetries && latest && now >= retryDoneAt(latest) ? shotPrice(sim.audio) : projectCost(sim.shots.length, sim.audio);
  return {
    id: sim.id,
    status,
    destination: sim.destination,
    format: sim.format,
    audio: sim.audio,
    created_at: new Date(sim.createdAt).toISOString(),
    shots: shots.map(shot => ({ ...shot, error: '' })),
    error: '',
    result: hasResult ? {
      ...SAMPLE_VIDEO,
      file_name: `${sim.sku || 'video'}-${sim.destination === 'ads' ? 'anuncio' : 'ficha'}.mp4`,
      title: '',
      version,
      provider: sim.audio ? 'gemini-api' : 'vertex-ai',
      model: 'veo-3.1',
      audio: sim.audio,
      charged: { amount: round(charged), currency: 'EUR' },
      fallback_from: null,
    } : null,
  };
}
