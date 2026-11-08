/**
 * Tipos de la pestaña A+ (prototipo: pim/aplus.js). Los módulos se guardan tal
 * cual en la porción `aplus` del almacén por producto (formato del prototipo).
 */
export type ModuleType = 'text-overlay' | 'specifications' | 'four-images' | 'header-image';
/** Tipos que se pueden añadir desde «Selecciona el tipo de módulo». */
export type EditableModuleType = Exclude<ModuleType, 'header-image'>;

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Imagen de un módulo A+ (APlusImage del original). */
export interface AplusImage {
  id: string;
  /** URL local (blob:), descargada (data:) o de relleno; null = «Procesando...». */
  url: string | null;
  file?: File | null;
  altText: string;
  dimensions: ImageDimensions;
  size: number;
  format: string;
  isValid: boolean;
  validationErrors: string[];
  /** Destino de subida en Amazon (sin él se envía 'dummy-image-id'). */
  uploadDestinationId?: string;
}

export interface TextOverlayContent {
  headline: string;
  bodyText: string;
  backgroundImage: AplusImage | null;
}

export interface SpecBlock {
  headline: string;
  subtitle: string;
  body: string;
}

export interface SpecsContent {
  mainHeadline: string;
  blocks: SpecBlock[];
  specificationHeadline: string;
  bulletPoints: string[];
  image: AplusImage | null;
}

export interface FourSection {
  headline: string;
  bodyText: string;
  image: AplusImage | null;
}

export interface FourImagesContent {
  generalHeadline: string;
  sections: FourSection[];
}

/** Imagen de encabezado estándar: solo llega desde Amazon (solo lectura). */
export interface HeaderImageContent {
  headline: string;
  image: AplusImage | null;
}

export interface ContentByType {
  'text-overlay': TextOverlayContent;
  specifications: SpecsContent;
  'four-images': FourImagesContent;
  'header-image': HeaderImageContent;
}

export interface ModuleOf<T extends ModuleType> {
  id: string;
  type: T;
  title: string;
  content: ContentByType[T];
  isValid: boolean;
  validationErrors: string[];
}

export type AplusModule = { [T in ModuleType]: ModuleOf<T> }[ModuleType];
export type ModuleContent = ContentByType[ModuleType];

/** Documento A+ de Amazon (lista del selector «Documento A+»). */
export interface AplusDocumentMetadata {
  name?: string;
  status?: string;
  brandName?: string;
  contentReferenceKey?: string;
  [field: string]: unknown;
}

export interface AplusDocument {
  contentReferenceKey?: string;
  contentMetadata?: AplusDocumentMetadata;
}

/** Lo que guarda la caché de la pestaña (useAplusCache del original). */
export interface AplusCacheData {
  modules: AplusModule[];
  brand: string;
  hasUnsavedChanges: boolean;
  availableDocuments: AplusDocument[];
  selectedDocumentKey: string;
}

export interface AplusCacheEntry {
  data: AplusCacheData;
  timestamp: number;
}

/**
 * Porción `aplus` del almacén: { content: { [asin | 'local']: { data, timestamp } }, crk: { [asin]: crk } }.
 * Un producto sin ASIN guarda sus módulos en 'local', sin caducidad.
 */
export interface AplusSlice {
  content?: Record<string, AplusCacheEntry>;
  crk?: Record<string, string>;
}

/** Módulos tal como los envía el frontend al backend (mapModulesToBackend). */
export type BackendModule =
  | {
      type: 'STANDARD_IMAGE_TEXT_OVERLAY';
      fields: { uploadDestinationId: string; altText: string; headline: string; subheadline: string; width_px: number; height_px: number };
    }
  | {
      type: 'STANDARD_SINGLE_IMAGE_SPECS_DETAIL';
      fields: { uploadDestinationId: string; altText: string; headline: string; specs: { label: string }[] };
    }
  | {
      type: 'STANDARD_FOUR_IMAGE_TEXT';
      fields: { images: string[]; texts: string[] };
    };

export type SaveOperation = 'draft' | 'link' | 'publish';
