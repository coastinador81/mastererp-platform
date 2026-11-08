/**
 * Tipos de la pestaña «Vídeo» (prototipo: pim/video.js, comentario «Estado (ctx.store)»).
 * Porciones del almacén del producto: `video` (biblioteca), `videoStudio` (estudio),
 * `videoView` ('library' | 'create') y `productInfo` ({ name, sku }).
 */

export type Destination = 'listing' | 'ads';
export type VideoFormat = '16:9' | '9:16';
export type VideoView = 'library' | 'create';
export type ImageSource = 'upload' | 'ai-generated';

/** Escena del vídeo: salto a un momento, con su miniatura. */
export interface Chapter {
  time: number;
  title: string;
  thumb: string;
}

/** Saldo descontado por una generación. */
export interface Charged {
  amount: number;
  currency: string;
}

/** Cómo se generó un vídeo con IA (línea «Generado con …»). */
export interface Generation {
  provider: string;
  model: string;
  audio: boolean;
  charged: Charged | null;
  fallbackFrom: string | null;
}

/** Vídeo de la biblioteca del producto. */
export interface VideoItem {
  id: string;
  name: string;
  url: string;
  poster: string;
  size: number;
  type: string;
  duration: number;
  width: number;
  height: number;
  codecs?: string;
  title: string;
  source: 'upload' | 'ai';
  destination?: Destination;
  language?: string;
  chapters?: Chapter[];
  generation?: Generation;
  /** El navegador no pudo leerlo (sin vista previa ni medidas). */
  unreadable?: boolean;
}

/** Porción `video`. */
export interface VideoLibrary {
  videos: VideoItem[];
  selectedId: string | null;
}

/** Referencia a una foto de la ficha (nunca la imagen: las data: llenarían el almacén). */
export interface ImageRef {
  id: string;
  url: string;
  name: string;
  width: number;
  height: number;
  source: ImageSource;
}

/** Plano del guion. */
export interface Shot {
  id: string;
  image: ImageRef | null;
  action: string;
  camera: string;
  text: string;
}

export interface Plan {
  origin: 'ficha' | 'ia';
  destination: Destination;
  shots: Shot[];
  closing: { tagline: string };
}

export type ProjectStatus = 'queued' | 'generating' | 'editing' | 'waiting' | 'done' | 'failed';
export type ShotStatus = 'queued' | 'generating' | 'done' | 'blocked' | 'failed';

export interface ProjectShot {
  id: string;
  status: ShotStatus;
  error: string;
}

export interface ProjectResult {
  url: string;
  poster: string;
  fileName: string;
  size: number;
  type: string;
  width: number;
  height: number;
  duration: number;
  codecs: string;
  title: string;
  version: number;
  generation: Generation;
}

/** Vídeo en curso en el estudio (GET /video/projects/{id}). */
export interface Project {
  id: string;
  status: ProjectStatus;
  destination: Destination;
  format: VideoFormat;
  audio: boolean;
  createdAt: string;
  shots: ProjectShot[];
  result: ProjectResult | null;
  error: string;
  announced: boolean;
  pollError: string;
}

/** Porción `videoStudio`. */
export interface StudioState {
  destination: Destination;
  format: VideoFormat;
  audio: boolean;
  plans: Partial<Record<Destination, Plan>>;
  project: Project | null;
}

/** Fila de requisitos de Amazon. */
export interface RequirementRow {
  id: string;
  label: string;
  need: string;
  value: string;
  ok: boolean;
  required: boolean;
  /** Valor en texto normal (no monoespaciado). */
  text?: boolean;
  /** «Falta» en lugar de «No cumple». */
  missing?: boolean;
}

export type IssueLevel = 'error' | 'warn';
export type IssueField = 'image' | 'action' | 'text' | 'tagline';

/** Aviso de la revisión del guion. */
export interface Issue {
  level: IssueLevel;
  message: string;
  field?: IssueField;
  /** Plano del aviso ('closing' = cierre de marca). */
  shot?: string;
}

/** Datos de la ficha que usa el vídeo (producto guardado + ediciones). */
export interface ProductData {
  name?: string;
  sku?: string;
  brand?: string;
  category?: string;
  description?: string;
  keywords?: string;
  bullets?: unknown[];
  image?: string;
  asin?: string;
  [field: string]: unknown;
}

/** Porción `productInfo` (nombre del producto para el seguimiento en segundo plano). */
export interface ProductInfo {
  name: string;
  sku: string;
}
