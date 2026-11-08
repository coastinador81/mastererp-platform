import { ApiError } from '@/shared/api/client';
import { ACTIVE, DESTINATIONS, MODELS, PROJECT_STATUSES, PROVIDERS, SHOT_STATUSES, isDestination } from './constants';
import { asArray, clip, isServerURL, money, safeMediaURL } from './format';
import type { Destination, Generation, Plan, Project, ProjectShot, ProjectStatus, ShotStatus, StudioState, VideoFormat, VideoItem } from './types';

/**
 * Vídeo en curso y resultado (prototipo: pim/video.js, projectFrom, resultLine…).
 * Lee con cuidado lo que devuelve el servidor: estados conocidos, URLs https o de
 * este origen y textos acotados.
 */

type Raw = Record<string, unknown>;

export function generationFrom(result: Raw, fallbackAudio: boolean): Generation {
  const charged = result.charged as { amount?: unknown; currency?: unknown } | null | undefined;
  const validCharge = Boolean(charged && typeof charged === 'object' && charged.amount !== undefined && charged.amount !== null && charged.amount !== '' && Number.isFinite(Number(charged.amount)));
  return {
    provider: String(result.provider || ''),
    model: String(result.model || 'veo-3.1'),
    audio: typeof result.audio === 'boolean' ? result.audio : Boolean(fallbackAudio),
    charged: validCharge && charged ? { amount: Number(charged.amount), currency: String(charged.currency || 'EUR') } : null,
    fallbackFrom: (result.fallback_from || result.fallbackFrom || null) as string | null,
  };
}

/** «Generado con Veo 3.1 (Gemini API) · con audio · 4,48 € de saldo» (texto aprobado). */
export function resultLine(generation: Generation | null | undefined): string {
  if (!generation) return '';
  const model = MODELS[generation.model] || generation.model || 'Veo 3.1';
  const provider = PROVIDERS[generation.provider] || generation.provider;
  const parts = [`Generado con ${model}${provider ? ` (${provider})` : ''}`, generation.audio ? 'con audio' : 'sin audio'];
  const spent = money(generation.charged);
  if (spent) parts.push(`${spent} de saldo`);
  return parts.join(' · ');
}

/** Línea de respaldo (texto aprobado). */
export function fallbackLine(generation: Pick<Generation, 'fallbackFrom'> | null | undefined): string {
  if (!generation?.fallbackFrom) return '';
  return PROVIDERS[generation.fallbackFrom]
    ? `${PROVIDERS[generation.fallbackFrom]} no estaba disponible en ese momento.`
    : 'El modelo previsto no estaba disponible en ese momento.';
}

export interface ProjectFallback {
  destination?: Destination;
  format?: VideoFormat;
  audio?: boolean;
  createdAt?: string;
  announced?: boolean;
}

export function projectFrom(data: unknown, fallback: ProjectFallback): Project | null {
  const wrapper = data as { project?: unknown } | null | undefined;
  const source = (wrapper?.project || data) as Raw | null | undefined;
  if (!source || source.id === undefined || source.id === null || source.id === '') return null;
  const audio = typeof source.audio === 'boolean' ? source.audio : Boolean(fallback.audio);
  const raw = (source.result ?? null) as Raw | null;
  const url = safeMediaURL(raw?.url);
  const result = raw && url ? {
    url,
    poster: safeMediaURL(raw.poster),
    fileName: String(raw.file_name || '').slice(0, 200),
    size: Number(raw.size) || 0,
    type: String(raw.type || 'video/mp4'),
    width: Number(raw.width) || 0,
    height: Number(raw.height) || 0,
    duration: Number(raw.duration) || 0,
    codecs: String(raw.codecs || '').slice(0, 80),
    title: String(raw.title || '').slice(0, 200),
    version: Number(raw.version) || 1,
    generation: generationFrom(raw, audio),
  } : null;
  return {
    id: String(source.id),
    status: (PROJECT_STATUSES.has(String(source.status)) ? source.status : 'queued') as ProjectStatus,
    destination: isDestination(source.destination) ? source.destination : fallback.destination ?? 'listing',
    format: source.format === '9:16' ? '9:16' : fallback.format || '16:9',
    audio,
    createdAt: fallback.createdAt || String(source.created_at || '') || new Date().toISOString(),
    shots: asArray<Raw>(source.shots)
      .filter(shot => shot && shot.id !== undefined && shot.id !== null)
      .map((shot): ProjectShot => ({
        id: String(shot.id),
        status: (SHOT_STATUSES.has(String(shot.status)) ? shot.status : 'queued') as ShotStatus,
        error: String(shot.error || '').slice(0, 300),
      })),
    result,
    error: String(source.error || '').slice(0, 300),
    announced: Boolean(fallback.announced),
    pollError: '',
  };
}

export const isActive = (project: Project | null | undefined): boolean => Boolean(project && ACTIVE.has(project.status));
export const locked = (state: Pick<StudioState, 'project'>): boolean => isActive(state.project);

/** Id del vídeo de la biblioteca que sale de un resultado. */
export const resultVideoId = (project: Pick<Project, 'id'> & { result: { version: number } | null }): string =>
  `video-${project.id}-${project.result?.version ?? 1}`;

/** El resultado como vídeo de la biblioteca (con las escenas del guion). */
export function libraryVideoFromProject(project: Project, plan: Plan | null | undefined, product: { name?: string; sku?: string } | null): VideoItem | null {
  const result = project.result;
  if (!result?.url) return null;
  const spec = DESTINATIONS[project.destination] || DESTINATIONS.listing;
  const name = product?.name ? clip(product.name, 100) : 'Vídeo del producto';
  return {
    id: resultVideoId(project),
    name: result.fileName || `${product?.sku || 'video'}-${project.destination === 'ads' ? 'anuncio' : 'ficha'}.mp4`,
    url: result.url,
    poster: result.poster,
    size: result.size,
    type: result.type,
    duration: result.duration,
    width: result.width,
    height: result.height,
    codecs: result.codecs,
    title: result.title || (project.destination === 'ads' ? `Anuncio · ${name}` : name),
    source: 'ai',
    destination: project.destination,
    language: 'es',
    chapters: plan ? plan.shots.map((shot, index) => ({ time: index * spec.shotSeconds, title: shot.text || `Plano ${index + 1}`, thumb: isServerURL(shot.image?.url) ? String(shot.image?.url) : '' })) : [],
    generation: result.generation,
  };
}

/** Avance del vídeo en curso (0-100), como la barra del prototipo. */
export function projectProgress(project: Project): { finished: number; total: number; pct: number } {
  const shots = asArray<ProjectShot>(project.shots);
  const finished = shots.filter(shot => shot.status === 'done').length;
  const total = shots.length;
  const pct = project.status === 'editing' ? 92
    : project.status === 'waiting' ? Math.round(88 * finished / Math.max(1, total))
      : Math.round(8 + 80 * finished / Math.max(1, total));
  return { finished, total, pct };
}

/** Nota bajo la barra del vídeo en curso. */
export function projectNote(project: Project, currentDestination: Destination): string {
  const waiting = project.status === 'waiting';
  const elsewhere = waiting && currentDestination !== project.destination;
  if (project.pollError) return 'No podemos consultar el estado ahora mismo; seguimos intentándolo.';
  if (elsewhere) return `Para terminar el vídeo ${project.destination === 'ads' ? 'del anuncio' : 'de la ficha de Amazon'}, rehaz los planos marcados.`;
  if (waiting) return 'Rehaz los planos marcados para terminar el vídeo.';
  return 'Puedes salir de esta pestaña: el vídeo se sigue generando.';
}

/** Mensaje para la persona: nunca el texto técnico en inglés del navegador o del servidor. */
export function reason(error: unknown): string {
  if (error instanceof ApiError) {
    const message = (error.data as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message.trim()) return message;
    return 'El servicio de vídeo no ha podido completarlo. Inténtalo de nuevo.';
  }
  const named = error as { name?: string; message?: string } | null;
  if (named?.name === 'TypeError' || named?.message === 'Network Error') return 'Sin conexión con el servicio de vídeo. Inténtalo de nuevo.';
  if (named?.name === 'SecurityError') return 'El servidor del vídeo no permite leer sus fotogramas.';
  return named?.message || 'Inténtalo de nuevo.';
}

/** Saldo insuficiente (402 o error «insufficient_balance»). */
export const insufficient = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 402 || (error.data as { error?: unknown } | null)?.error === 'insufficient_balance');

/** Estado HTTP de un error de la API (o undefined si no llegó respuesta). */
export const httpStatus = (error: unknown): number | undefined => (error instanceof ApiError ? error.status : undefined);
