import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePimScope, usePimSlice } from '@/shared/pim';
import { alive } from '../lib/media';
import { draftPlan, resolvePlan, validPlan } from '../model/plan';
import { hasDeadVideos, initialView, readLibrary, readStudio } from '../model/studio';
import type { Destination, Plan, StudioState, VideoItem, VideoLibrary, VideoView } from '../model/types';
import { writeLibraryTo, writeStudioTo } from '../jobs/scope';
import type { ProductView } from './useProductData';

/**
 * Porciones del vídeo del producto de la pestaña: biblioteca, vista y estudio
 * (prototipo: pim/video.js, read/write, view, readStudio/writeStudio, planFor).
 */

export interface LibraryApi extends VideoLibrary {
  current: VideoItem | null;
  write: (updater: (current: VideoLibrary) => VideoLibrary) => void;
  patchVideo: (id: string, patch: Partial<VideoItem>) => void;
  select: (id: string) => void;
}

export function useVideoLibrary(): LibraryApi {
  const scope = usePimScope();
  const [saved] = usePimSlice<unknown>('video', null);
  const library = useMemo(() => readLibrary(saved, alive), [saved]);
  const write = useCallback((updater: (current: VideoLibrary) => VideoLibrary) => writeLibraryTo(scope, updater), [scope]);
  const patchVideo = useCallback((id: string, patch: Partial<VideoItem>) => {
    write(state => ({ ...state, videos: state.videos.map(video => (video.id === id ? { ...video, ...patch } : video)) }));
  }, [write]);
  const select = useCallback((id: string) => write(state => ({ ...state, selectedId: id })), [write]);

  // Lo que el navegador ya no puede abrir (blob: de otra carga) se suelta, una vez.
  const cleaned = useRef(false);
  useEffect(() => {
    if (cleaned.current) return;
    cleaned.current = true;
    if (hasDeadVideos(saved, alive)) write(state => ({ ...state, selectedId: readLibrary(saved, alive).selectedId }));
  }, [saved, write]);

  const current = library.videos.find(video => video.id === library.selectedId) || null;
  return { ...library, current, write, patchVideo, select };
}

/**
 * La vista se fija una vez: sin vídeos, el estudio; después solo la cambian las
 * pestañas, «Ver en Vídeos del producto» y subir un vídeo.
 */
export function useVideoView(hasVideos: boolean): [VideoView, (view: VideoView) => void] {
  const [saved, setSaved] = usePimSlice<unknown>('videoView', null);
  const view = initialView(saved, hasVideos);
  useEffect(() => {
    if (saved !== 'library' && saved !== 'create') setSaved(view);
  }, [saved, setSaved, view]);
  const set = useCallback((next: VideoView) => setSaved(next), [setSaved]);
  return [view, set];
}

export interface StudioApi {
  state: StudioState;
  write: (updater: (current: StudioState) => StudioState) => void;
  /** Guion guardado del destino o, si no hay, el borrador desde la ficha (sin guardarlo). */
  planFor: (destination?: Destination) => Plan;
  /** Guion con las fotos resueltas con las de la ficha. */
  resolved: Plan;
  patchPlan: (destination: Destination, updater: (plan: Plan) => Plan) => void;
  patchShot: (destination: Destination, shotId: string, patch: Partial<Plan['shots'][number]>) => void;
}

export function useVideoStudio({ product, images }: Pick<ProductView, 'product' | 'images'>): StudioApi {
  const scope = usePimScope();
  const [saved] = usePimSlice<unknown>('videoStudio', null);
  const state = useMemo(() => readStudio(saved), [saved]);
  const write = useCallback((updater: (current: StudioState) => StudioState) => writeStudioTo(scope, updater), [scope]);

  const planOf = useCallback((studio: StudioState, destination: Destination): Plan => {
    const stored = studio.plans[destination];
    return validPlan(stored, destination) ? stored : draftPlan(destination, product, images);
  }, [product, images]);
  const planFor = useCallback((destination?: Destination) => planOf(state, destination ?? state.destination), [planOf, state]);
  const resolved = useMemo(() => resolvePlan(planOf(state, state.destination), images), [planOf, state, images]);

  const patchPlan = useCallback((destination: Destination, updater: (plan: Plan) => Plan) => {
    write(studio => ({ ...studio, plans: { ...studio.plans, [destination]: updater(planOf(studio, destination)) } }));
  }, [write, planOf]);
  const patchShot = useCallback((destination: Destination, shotId: string, patch: Partial<Plan['shots'][number]>) => {
    patchPlan(destination, plan => ({ ...plan, shots: plan.shots.map(shot => (shot.id === shotId ? { ...shot, ...patch } : shot)) }));
  }, [patchPlan]);

  return { state, write, planFor, resolved, patchPlan, patchShot };
}
