import { clamp } from '@/shared/lib';
import { asArray } from '../model/format';
import type { Chapter, VideoItem } from '../model/types';
import { disposeProbe, frameToDataURL, seek, seekableProbe } from './media';

/**
 * Detección de escenas en el navegador (prototipo: pim/video.js, detectScenes):
 * compara cada fotograma con el de ~1 s antes (así un fundido también cuenta) y
 * marca los picos que destacan sobre el resto del vídeo, con al menos 2 s entre
 * escenas. Conserva el título de una escena que ya existía en ese momento.
 */

export interface DetectOptions {
  onProgress: (value: number) => void;
  cancelled: () => boolean;
}

/** Diferencia media por píxel (0-255) entre dos fotogramas RGBA. */
export function frameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / (a.length / 4) / 3;
}

/**
 * Momentos de corte a partir de las puntuaciones de cambio (pura, para las pruebas).
 * Lanza un error si todos los fotogramas son idénticos (el navegador no pudo leerlos).
 */
export function findCuts(scores: number[], times: number[], span: number, duration: number): number[] {
  const sample = scores.slice(span);
  if (!sample.some(value => value > 0.5)) throw new Error('No se pudieron leer los fotogramas del vídeo. Inténtalo de nuevo con la pestaña a la vista.');
  const mean = sample.reduce((total, value) => total + value, 0) / Math.max(1, sample.length);
  const deviation = Math.sqrt(sample.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(1, sample.length));
  const threshold = Math.max(mean + 1.2 * deviation, 16);
  const cuts = [0];
  for (let index = span; index < scores.length;) {
    if (scores[index] < threshold) {
      index += 1;
      continue;
    }
    let peak = index;
    while (index < scores.length && scores[index] >= threshold) {
      if (scores[index] > scores[peak]) peak = index;
      index += 1;
    }
    const time = Math.round(times[peak] * 10) / 10;
    if (time - cuts[cuts.length - 1] >= 2 && duration - time >= 1) cuts.push(time);
  }
  return cuts;
}

export async function detectScenes(video: Pick<VideoItem, 'url' | 'chapters'>, { onProgress, cancelled }: DetectOptions): Promise<{ chapters: Chapter[]; duration: number } | null> {
  const probe = await seekableProbe(video.url);
  try {
    const duration = probe.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('No se pudo leer la duración del vídeo.');
    const step = clamp(duration / 160, 0.2, 1);
    const W = 64;
    const H = 36;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No se pudieron leer los fotogramas del vídeo. Inténtalo de nuevo con la pestaña a la vista.');
    const frames: Uint8ClampedArray[] = [];
    const times: number[] = [];
    for (let time = 0; time < duration - 0.05; time += step) {
      if (cancelled()) return null;
      await seek(probe, time);
      context.drawImage(probe, 0, 0, W, H);
      frames.push(context.getImageData(0, 0, W, H).data.slice());
      times.push(time);
      onProgress(Math.round((time / duration) * 85));
    }
    const span = Math.max(1, Math.round(1 / step));
    const scores = frames.map((frame, index) => (index >= span ? frameDifference(frame, frames[index - span]) : 0));
    const cuts = findCuts(scores, times, span, duration);
    const chapters: Chapter[] = [];
    for (const [index, time] of cuts.entries()) {
      if (cancelled()) return null;
      await seek(probe, Math.min(duration - 0.05, time + 0.3));
      const existing = asArray<Chapter>(video.chapters).find(chapter => Math.abs(chapter.time - time) <= 1.2);
      chapters.push({ time, title: existing?.title || `Escena ${index + 1}`, thumb: frameToDataURL(probe, 320, 0.72) });
      onProgress(85 + Math.round(((index + 1) / cuts.length) * 15));
    }
    return { chapters, duration };
  } finally {
    disposeProbe(probe);
  }
}
