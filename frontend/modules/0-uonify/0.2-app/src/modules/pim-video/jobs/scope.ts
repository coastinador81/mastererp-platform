import { pimStore, type PimScope } from '@/shared/pim';
import { alive } from '../lib/media';
import { readLibrary, readStudio } from '../model/studio';
import type { StudioState, VideoLibrary } from '../model/types';

/**
 * Lectura y escritura de las porciones del vídeo sobre el ámbito de un producto
 * (sirve igual a la pestaña montada y al trabajo en segundo plano).
 */

/** Un producto eliminado ya no tiene nada en el almacén: no se le vuelve a escribir. */
export const exists = (scope: PimScope): boolean => Object.keys(pimStore.all(scope.key)).length > 0;

export const readStudioFrom = (scope: PimScope): StudioState => readStudio(scope.get('videoStudio', null));

export function writeStudioTo(scope: PimScope, updater: (current: StudioState) => StudioState): void {
  const current = readStudioFrom(scope);
  const next = updater(current);
  if (next !== current) scope.set('videoStudio', next);
}

export const readLibraryFrom = (scope: PimScope): VideoLibrary => readLibrary(scope.get('video', null), alive);

/** Actualiza la biblioteca soltando lo que el navegador ya no puede abrir. */
export function writeLibraryTo(scope: PimScope, updater: (current: VideoLibrary) => VideoLibrary): void {
  scope.update<VideoLibrary | null>('video', saved => {
    const current: VideoLibrary = {
      videos: (Array.isArray(saved?.videos) ? saved.videos : []).filter(video => video && alive(video.url)),
      selectedId: saved?.selectedId || null,
    };
    return updater(current);
  }, null);
}
