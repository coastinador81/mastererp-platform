import type { ValidationData } from './types';

/**
 * Validación y análisis de un modelo subido (prototipo: Model3DUploader de
 * pim/modelos3d.js). El análisis es simulado, como en el original: +10 % cada
 * 150 ms; triángulos 20000-169999, texturas (80 %), materiales (90 %; si no,
 * error crítico) y puntuación.
 */

export const MAX_MODEL_SIZE = 50 * 1024 * 1024;
const VALID_EXTENSIONS = ['.glb', '.gltf'];
const VALID_MIME_TYPES = ['model/gltf-binary', 'model/gltf+json', 'application/octet-stream'];

export type FileValidation = { isValid: true } | { isValid: false; error: string };

/** Validar archivo de modelo 3D (extensión, tamaño y tipo). */
export function validateModelFile(file: Pick<File, 'name' | 'size' | 'type'>): FileValidation {
  const fileName = file.name.toLowerCase();
  const hasValidExtension = VALID_EXTENSIONS.some(ext => fileName.endsWith(ext));
  if (!hasValidExtension) return { isValid: false, error: 'Formato no soportado. Use GLB o glTF.' };
  if (file.size > MAX_MODEL_SIZE) return { isValid: false, error: 'Archivo muy grande. Máximo 50MB.' };
  if (file.type && !VALID_MIME_TYPES.includes(file.type) && !hasValidExtension) {
    return { isValid: false, error: 'Tipo de archivo no válido.' };
  }
  return { isValid: true };
}

const TEXTURES = ['1024x1024', '2048x2048', '4096x4096'];

/** Resultado del análisis simulado (cuando la barra llega al 100 %). */
export function analysisResult(random: () => number = Math.random): ValidationData {
  const warnings: string[] = [];
  const errors: string[] = [];
  const triangles = Math.floor(random() * 150000) + 20000;
  const vertices = Math.floor(triangles * 0.6);
  const hasTextures = random() > 0.2;
  const hasMaterials = random() > 0.1;
  if (triangles > 200000) warnings.push('Alto número de triángulos. Considera optimizar para mejor rendimiento.');
  if (triangles < 1000) warnings.push('Modelo muy simple. Puede no verse bien en algunos contextos.');
  if (!hasTextures) warnings.push('El modelo no tiene texturas. Se recomienda agregar texturas PBR.');
  if (!hasMaterials) errors.push('El modelo no tiene materiales definidos.');
  const score = Math.max(0, Math.min(100, 100 - warnings.length * 5 - errors.length * 15));
  return {
    triangles,
    vertices,
    textureResolution: hasTextures ? TEXTURES[Math.floor(random() * 3)] : 'Sin texturas',
    hasTextures,
    hasMaterials,
    validationScore: score,
    warnings,
    errors,
  };
}

/** Formato mostrado del archivo subido. */
export const modelFormat = (name: string): string => (name.toLowerCase().endsWith('.glb') ? 'GLB' : 'glTF');
