/**
 * Tipos de la pestaña «3D» (prototipo: pim/modelos3d.js). La porción del
 * almacén es `model3d` (useProductState.model3D del original + upload_id,
 * key del archivo elegido y los modelos que ya trae el producto).
 */

/** Categoría del visor (el selector se retiró; se usa siempre 'floor'). */
export type Model3DCategory = 'floor' | 'wall' | 'ceiling' | 'glasses' | 'footwear' | 'mirror';

/** Calidad simulada que el visor comunica al cambiar de modelo. */
export interface QualityInfo {
  triangles: number;
  vertices?: number;
  textureResolution: string;
  validationScore: number;
}

/** Metadatos de un archivo .glb (lista del servidor o del producto). */
export interface Model3DMetadata {
  polygons?: number;
  texture_resolution?: string;
  format?: string;
  compression?: string;
  file_size?: number;
  [field: string]: unknown;
}

/** Archivo de modelo: del servidor (output/<uploadId>/…) o del producto (`local`). */
export interface Model3DFile {
  key: string;
  url: string;
  size: number;
  type?: string;
  /** El producto ya lo trae (porción model3d.files): se gestiona en local. */
  local?: boolean;
  metadata?: Model3DMetadata;
}

/** Porción `model3d` del almacén por producto. */
export interface Model3DState {
  selected3DModel: string | null;
  selectedKey: string | null;
  isGenerating3D: boolean;
  generation3DProgress: number;
  model3DCategory: Model3DCategory;
  modelQualityInfo: QualityInfo | null;
  uploadId: string | null;
  files?: Model3DFile[];
}

export type Model3DPatch = Partial<Model3DState>;

/** Resultado del análisis de un modelo (Uploader) o de la generación con IA. */
export interface ValidationData {
  triangles: number;
  vertices: number;
  textureResolution: string;
  hasTextures: boolean;
  hasMaterials: boolean;
  validationScore: number;
  warnings: string[];
  errors: string[];
}

/** Modelo listo para abrir en el visor (onGenerationComplete / onUploadComplete). */
export interface ModelData {
  url: string;
  name: string;
  size: number;
  format: string;
  validationData: ValidationData;
}

export type GenerationQuality = 'draft' | 'standard' | 'high' | 'ultra';
export type PolyCount = 'low' | 'medium' | 'high';
export type TextureResolution = '1024' | '2048' | '4096';

export interface GeneratorConfig {
  quality: GenerationQuality;
  polyCount: PolyCount;
  textureResolution: TextureResolution;
  generatePBR: boolean;
  optimizeForAR: boolean;
  includeAnimations: boolean;
}

/** Imagen de la galería del producto (pestaña Imágenes) o subida para generar. */
export interface SourceImage {
  id?: string;
  url: string;
  name?: string;
  [field: string]: unknown;
}

export type ImageSource = 'gallery' | 'upload';

export type EnvPreset = 'studio' | 'sunset' | 'dawn' | 'night';
export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/** Controles del visor (Model3DViewer). */
export interface ViewerSettings {
  showGrid: boolean;
  showWireframe: boolean;
  showAxes: boolean;
  autoRotate: boolean;
  lightIntensity: number;
  environmentPreset: EnvPreset;
}

export type ViewerSwitchKey = 'showGrid' | 'showWireframe' | 'showAxes' | 'autoRotate';

/** Ajustes de la Vista AR («Controles AR»). */
export interface ARSettings {
  showGrid: boolean;
  showAxes: boolean;
  autoRotate: boolean;
  scale: number;
  lightIntensity: number;
}

export type ARTab = 'qr' | 'camera' | 'preview';
export type CameraPermission = 'pending' | 'granted' | 'denied';
