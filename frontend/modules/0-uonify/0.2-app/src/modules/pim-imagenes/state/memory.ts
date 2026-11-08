import { createStore } from 'zustand/vanilla';
import { DEFAULT_STYLE } from '../model/labels';
import type { CatalogImage, ProductInfo, StyleConfig } from '../model/types';

/**
 * Memoria de la pestaña (prototipo: `memory` de pim/imagenes.js). Lo que el
 * original guardaba en el componente padre: dura mientras la página está abierta
 * (sobrevive al cambio de pestaña y de producto) y se pierde al recargar.
 *
 * - `imagesMemory`: estado que pinta la interfaz (zustand, se suscribe con
 *   useImagesMemory). Como en el prototipo, el scraping, la generación y el
 *   redimensionado son globales: una sola operación de cada tipo a la vez.
 * - `session`: cachés que no se pintan.
 */

export interface ScrapingState {
  /** Producto que pidió el scraping. */
  key: string;
  /** 0-100 (simulado, como el original: hasta el 90 % hasta que responde). */
  progress: number;
}

export interface ImagesMemoryState {
  imageUrl: string;
  scraping: ScrapingState | null;
  isGeneratingAI: boolean;
  isProcessingImages: boolean;
  /** Producto → ids seleccionados. */
  selection: Record<string, string[]>;
  /** Producto → imágenes del catálogo de Amazon. */
  catalog: Record<string, CatalogImage[]>;
}

const initialState = (): ImagesMemoryState => ({
  imageUrl: '',
  scraping: null,
  isGeneratingAI: false,
  isProcessingImages: false,
  selection: {},
  catalog: {},
});

export const imagesMemory = createStore<ImagesMemoryState>(initialState);

export const session = {
  /** Último producto montado: al cambiar se limpia la selección. */
  lastKey: null as string | null,
  /** Producto → datos del producto guardado. */
  products: new Map<string, ProductInfo | null>(),
  /** Producto → ASIN pedido al catálogo de Amazon. */
  catalogAsin: new Map<string, string>(),
  /** URLs blob: creadas en esta página (las de antes de recargar ya no existen). */
  liveBlobs: new Set<string>(),
  /** Estilo con el que genera Uony. */
  aiStyleConfig: { ...DEFAULT_STYLE } as StyleConfig,
};

/** Una URL blob: solo vale si se creó en esta página. */
export const isAlive = (url: unknown): boolean => {
  const text = String(url ?? '');
  return !text.startsWith('blob:') || session.liveBlobs.has(text);
};

const NO_SELECTION: string[] = [];

export const selectionOf = (key: string): string[] => imagesMemory.getState().selection[key] ?? NO_SELECTION;

export function setSelection(key: string, ids: string[]): void {
  const current = imagesMemory.getState().selection[key] ?? NO_SELECTION;
  if (current.length === ids.length && current.every((id, index) => id === ids[index])) return;
  imagesMemory.setState(state => ({ selection: { ...state.selection, [key]: ids } }));
}

export function setCatalog(key: string, images: CatalogImage[] | null): void {
  imagesMemory.setState(state => {
    const { [key]: _previous, ...rest } = state.catalog;
    return { catalog: images ? { ...rest, [key]: images } : rest };
  });
}

export const setImageUrl = (imageUrl: string): void => imagesMemory.setState({ imageUrl });

/** Vuelve al estado inicial (pruebas). */
export function resetImagesMemory(): void {
  imagesMemory.setState(initialState());
  session.lastKey = null;
  session.products.clear();
  session.catalogAsin.clear();
  session.liveBlobs.clear();
  session.aiStyleConfig = { ...DEFAULT_STYLE };
}
