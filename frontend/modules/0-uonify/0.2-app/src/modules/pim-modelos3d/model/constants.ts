import type { ARSettings, CameraView, EnvPreset, GeneratorConfig, Model3DState, ViewerSettings, ViewerSwitchKey } from './types';

/**
 * Constantes de la pestaña «3D» (prototipo: pim/modelos3d.js, «constantes»).
 */

/**
 * Materiales de la escena y del lienzo AR (WebGL y canvas no leen variables CSS):
 * cubo de reserva en el azul de marca (Blue 500 / 700), rejilla neutra
 * (Neutral 200 / 300) y ejes con la convención X rojo · Y verde · Z azul.
 */
export const SCENE = Object.freeze({
  cube: '#096BDC',
  cubeGlow: '#064FA7',
  wire: '#8595A6',
  gridCell: '#D3DDE7',
  gridSection: '#B9C8D6',
  axisX: '#B3261E',
  axisY: '#0F6B45',
  axisZ: '#096BDC',
  clear: '#f8fafc',
});

export const ENV_PRESETS: readonly EnvPreset[] = ['studio', 'sunset', 'dawn', 'night'];
export const CAMERA_VIEWS: readonly CameraView[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/** drei <Environment preset>: mismos HDR (drei-assets, commit 456060a) servidos por jsdelivr. */
export const HDRI_ROOT = 'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@456060a26bbeb8fdf79326f224b6d99b8bcce736/hdri/';
export const HDRI: Record<EnvPreset, string> = {
  studio: 'studio_small_03_1k.hdr',
  sunset: 'venice_sunset_1k.hdr',
  dawn: 'kiara_1_dawn_1k.hdr',
  night: 'dikhololo_night_1k.hdr',
};
/** Decodificador DRACO (modelos comprimidos), el mismo del original. */
export const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';

/** URL del modelo simulado de la generación con IA: se pinta como el cubo de EmptyModel. */
export const GENERATED_MODEL = 'generated';

/** useProductState.model3D (valores por defecto) + upload_id y key del archivo elegido. */
export const DEFAULT_3D: Readonly<Model3DState> = Object.freeze({
  selected3DModel: null,
  selectedKey: null,
  isGenerating3D: false,
  generation3DProgress: 0,
  model3DCategory: 'floor',
  modelQualityInfo: null,
  uploadId: null,
});

export const DEFAULT_VIEWER_SETTINGS: Readonly<ViewerSettings> = Object.freeze({
  showGrid: true,
  showWireframe: false,
  showAxes: false,
  autoRotate: false,
  lightIntensity: 1,
  environmentPreset: 'studio',
});

export const VIEWER_SWITCHES: readonly { key: ViewerSwitchKey; label: string }[] = [
  { key: 'showGrid', label: 'Cuadrícula' },
  { key: 'showWireframe', label: 'Wireframe' },
  { key: 'showAxes', label: 'Ejes' },
  { key: 'autoRotate', label: 'Auto-Rotar' },
];

/** Posiciones de «Vistas de Cámara» (distancia 5). */
export const CAMERA_POSITIONS: Record<CameraView, [number, number, number]> = {
  front: [0, 2, 5],
  back: [0, 2, -5],
  left: [-5, 2, 0],
  right: [5, 2, 0],
  top: [0, 5, 0],
  bottom: [0, -5, 0],
};

/** Encuadre de la cámara inicial: 5,5 unidades de ancho y 1,9 de alto como máximo. */
export const FIT_WIDTH = 5.5;
export const FIT_HEIGHT = 1.9;

export const DEFAULT_GENERATOR_CONFIG: Readonly<GeneratorConfig> = Object.freeze({
  quality: 'standard',
  polyCount: 'medium',
  textureResolution: '2048',
  generatePBR: true,
  optimizeForAR: true,
  includeAnimations: false,
});

export const DEFAULT_AR_SETTINGS: Readonly<ARSettings> = Object.freeze({
  showGrid: true,
  showAxes: false,
  autoRotate: true,
  scale: 1,
  lightIntensity: 0.8,
});

/** Tiempo máximo de la subida de un modelo (120 s, como el original). */
export const UPLOAD_TIMEOUT = 120_000;
/** Vigencia pedida para la URL firmada de descarga (1 h). */
export const SIGNED_URL_EXPIRES = 3600;
