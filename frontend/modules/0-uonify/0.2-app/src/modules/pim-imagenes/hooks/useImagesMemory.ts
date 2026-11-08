import { useStore } from 'zustand';
import { imagesMemory, type ImagesMemoryState } from '../state/memory';

/** Lee la memoria de la pestaña (el selector debe devolver valores estables). */
export function useImagesMemory<T>(selector: (state: ImagesMemoryState) => T): T {
  return useStore(imagesMemory, selector);
}
