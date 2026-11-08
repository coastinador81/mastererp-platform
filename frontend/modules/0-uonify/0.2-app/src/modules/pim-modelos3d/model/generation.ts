import { GENERATED_MODEL } from './constants';
import type { GeneratorConfig, ModelData, PolyCount, TextureResolution } from './types';

/**
 * Generación con IA (prototipo: Model3DGenerator de pim/modelos3d.js). Simulada
 * como en el original: 9 pasos de 300-700 ms; triángulos, tamaño y puntuación
 * aleatorios; el resultado se pinta como el cubo de EmptyModel.
 */

export interface GenerationStep {
  progress: number;
  step: string;
}

export const GENERATION_STEPS: readonly GenerationStep[] = [
  { progress: 0, step: 'Iniciando generación...' },
  { progress: 15, step: 'Analizando imágenes fuente...' },
  { progress: 30, step: 'Detectando profundidad y geometría...' },
  { progress: 45, step: 'Construyendo malla 3D...' },
  { progress: 60, step: 'Generando texturas PBR...' },
  { progress: 75, step: 'Optimizando geometría...' },
  { progress: 85, step: 'Aplicando materiales...' },
  { progress: 95, step: 'Validando modelo...' },
  { progress: 100, step: '¡Modelo generado exitosamente!' },
];

/** Espera de cada paso: 300-700 ms. */
export const stepDelay = (random: () => number = Math.random): number => 300 + random() * 400;

const BASE_TIME: Record<GeneratorConfig['quality'], number> = { draft: 30, standard: 60, high: 120, ultra: 240 };
const POLY_MULTIPLIER: Record<PolyCount, number> = { low: 0.8, medium: 1, high: 1.5 };
const TEXTURE_MULTIPLIER: Record<TextureResolution, number> = { 1024: 0.8, 2048: 1, 4096: 1.5 };

/** «Tiempo estimado» en segundos. */
export function estimatedTime(config: Pick<GeneratorConfig, 'quality' | 'polyCount' | 'textureResolution'>): number {
  return Math.round(BASE_TIME[config.quality] * POLY_MULTIPLIER[config.polyCount] * TEXTURE_MULTIPLIER[config.textureResolution]);
}

/** Triángulos del modelo según el «Nivel de Detalle». */
export function simulatedTriangles(polyCount: PolyCount, random: () => number = Math.random): number {
  if (polyCount === 'low') return Math.floor(random() * 30000) + 10000;
  if (polyCount === 'high') return Math.floor(random() * 120000) + 80000;
  return Math.floor(random() * 80000) + 40000;
}

/** Resultado de la generación simulada (onGenerationComplete). */
export function buildGeneratedModel(
  config: GeneratorConfig,
  category: string | null | undefined,
  { random = Math.random, now = Date.now }: { random?: () => number; now?: () => number } = {},
): ModelData {
  const triangles = simulatedTriangles(config.polyCount, random);
  return {
    url: GENERATED_MODEL,
    name: `model-${category ?? 'product'}-${now()}.glb`,
    size: Math.floor(random() * 10000000) + 5000000,
    format: 'GLB',
    validationData: {
      triangles,
      vertices: Math.floor(triangles * 0.6),
      textureResolution: `${config.textureResolution}x${config.textureResolution}`,
      hasTextures: true,
      hasMaterials: config.generatePBR,
      validationScore: Math.floor(random() * 10) + 90,
      warnings: [],
      errors: [],
    },
  };
}

/** Modelo elegido de los resultados del servidor («Usar Modelo Seleccionado»). */
export function serverModelData(file: { url: string; key: string; size: number }, name: string): ModelData {
  return {
    url: file.url,
    name: name || 'model.glb',
    size: file.size,
    format: 'GLB',
    validationData: {
      triangles: 50000,
      vertices: 30000,
      textureResolution: '2048x2048',
      hasTextures: true,
      hasMaterials: true,
      validationScore: 95,
      warnings: [],
      errors: [],
    },
  };
}

/** Calidad que guarda la ficha tras generar o subir un modelo. */
export const qualityFrom = ({ validationData }: ModelData) => ({
  triangles: validationData.triangles,
  textureResolution: validationData.textureResolution,
  validationScore: validationData.validationScore,
});
