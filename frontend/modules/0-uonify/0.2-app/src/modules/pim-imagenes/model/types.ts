/**
 * Tipos de la pestaña «Imágenes» (prototipo: pim/imagenes.js). Las imágenes se
 * guardan en el almacén del producto con este formato: 3D, A+, Auditoría IA y el
 * guardado leen la porción 'images'.
 */

/**
 * Origen de una imagen. 'scraped' es el que usa Auditoría IA al añadir imágenes
 * (ADD-02); la galería lo trata como 'scrape'.
 */
export type ImageSource = 'upload' | 'scrape' | 'scraped' | 'amazon' | 'ai-generated';

export type ImageStatus = 'pending' | 'ready' | 'processed' | 'generated' | 'failed';

export interface Dimensions {
  width: number;
  height: number;
}

/** Estilo con el que Uony genera imágenes (configuración predeterminada del original). */
export interface StyleConfig {
  style: string;
  quality: string;
  aspectRatio: string;
  lighting: string;
  background: string;
  mood: string;
}

/** Una imagen de la galería (subida, scrapeada, del producto, de Amazon, de IA o procesada). */
export interface ImageItem {
  id: string;
  url: string;
  name?: string;
  size?: number;
  type?: string;
  source?: ImageSource | string;
  status?: ImageStatus | string;
  dimensions?: Partial<Dimensions> | null;
  originalDimensions?: Partial<Dimensions> | null;
  processedDimensions?: Partial<Dimensions> | null;
  /** Procesadas antiguas: URL del resultado aparte de la original. */
  processedUrl?: string;
  /** Imágenes de IA. */
  style?: string;
  prompt?: string;
  styleConfig?: StyleConfig;
  /** Solo en memoria (nunca se guarda). */
  file?: unknown;
}

/** Grupos que guarda la pestaña (lo demás se deriva del producto). */
export interface ImageLists {
  uploaded: ImageItem[];
  scraped: ImageItem[];
  processed: ImageItem[];
  ai: ImageItem[];
}

/** Imágenes del producto guardado y del catálogo de Amazon. */
export interface DerivedImages {
  productImages: ImageItem[];
  amazonImages: ImageItem[];
}

/** Lo que la pestaña necesita del producto guardado (selectedProductData del original). */
export interface ProductInfo {
  id: string;
  images: unknown[];
  asin: string | null;
  source: unknown;
  image: string | null;
}

/** Imagen del catálogo de Amazon (GET /amazon/catalog/{asin}/images). */
export interface CatalogImage {
  variant?: string;
  link?: string;
  height?: number;
  width?: number;
}

/** Porciones del almacén que lee la pestaña. */
export interface ImageSlices {
  images?: unknown;
  processedImages?: unknown;
  aiImages?: unknown;
}

/** Estado derivado para pintar la pestaña. */
export interface ImagesSnapshot {
  lists: ImageLists;
  derived: DerivedImages;
  /** allImages del original: subidas, scrapeadas, del producto, Amazon, IA y procesadas. */
  all: ImageItem[];
  /** Selección sin ids que ya no existen. */
  selection: string[];
}

export type ImageKind = 'upload' | 'scrape' | 'amazon';
