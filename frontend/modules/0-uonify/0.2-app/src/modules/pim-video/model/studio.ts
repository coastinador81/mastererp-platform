import { DESTINATIONS, isDestination } from './constants';
import { asArray } from './format';
import type { StudioState, VideoFormat, VideoItem, VideoLibrary, VideoView } from './types';

/**
 * Lectura normalizada de las porciones `videoStudio`, `video` y `videoView`
 * (prototipo: pim/video.js, readStudioFrom, read y view).
 */

export function readStudio(saved: unknown): StudioState {
  const value = (saved && typeof saved === 'object' ? saved : {}) as Partial<StudioState> & Record<string, unknown>;
  const plans = value.plans && typeof value.plans === 'object' ? value.plans : {};
  const project = value.project && typeof value.project === 'object' && (value.project as { id?: unknown }).id ? value.project : null;
  return {
    destination: isDestination(value.destination) ? value.destination : 'listing',
    format: value.format === '9:16' ? '9:16' : '16:9',
    audio: value.audio !== false,
    plans,
    project,
  };
}

/** El formato elegido, si el destino lo admite (el anuncio solo admite 16:9). */
export const effectiveFormat = (state: Pick<StudioState, 'destination' | 'format'>): VideoFormat =>
  (DESTINATIONS[state.destination].formats.includes(state.format) ? state.format : '16:9');

/**
 * Biblioteca sin lo que el navegador ya no puede abrir (`isAlive` decide; en la app,
 * las blob: de otra carga de la página) y con un vídeo elegido válido.
 */
export function readLibrary(saved: unknown, isAlive: (url: unknown) => boolean): VideoLibrary {
  const value = (saved && typeof saved === 'object' ? saved : {}) as Partial<VideoLibrary>;
  const videos = asArray<VideoItem>(value.videos).filter(video => video && isAlive(video.url));
  const selectedId = videos.some(video => video.id === value.selectedId) ? (value.selectedId as string) : videos[0]?.id || null;
  return { videos, selectedId };
}

/** Si la porción guardada tiene vídeos que ya no se pueden abrir. */
export const hasDeadVideos = (saved: unknown, isAlive: (url: unknown) => boolean): boolean =>
  asArray<VideoItem>((saved as Partial<VideoLibrary> | null)?.videos).some(video => !isAlive(video?.url));

/** La vista se fija una vez: sin vídeos, el estudio. */
export const initialView = (saved: unknown, hasVideos: boolean): VideoView =>
  (saved === 'library' || saved === 'create' ? saved : hasVideos ? 'library' : 'create');
