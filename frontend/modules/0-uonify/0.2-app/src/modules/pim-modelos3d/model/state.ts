import { DEFAULT_3D } from './constants';
import { asArray } from './format';
import type { Model3DFile, Model3DMetadata, Model3DPatch, Model3DState } from './types';

/**
 * Lógica pura de la porción `model3d` (prototipo: get3D / set3D de pim/modelos3d.js).
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Estado completo a partir de lo guardado. Sin selector de categoría (retirado
 * por el dueño): el visor usa siempre la de suelo, que apoya el modelo en la rejilla.
 */
export function normalize3D(saved: unknown): Model3DState {
  const state: Model3DState = { ...DEFAULT_3D, ...(isObject(saved) ? (saved as Partial<Model3DState>) : {}) };
  state.model3DCategory = 'floor';
  return state;
}

/** Mezcla un cambio sobre lo guardado (como set3D: valores por defecto + guardado + cambio). */
export function merge3D(saved: unknown, patch: Model3DPatch): Model3DState {
  return { ...DEFAULT_3D, ...(isObject(saved) ? (saved as Partial<Model3DState>) : {}), ...patch };
}

/** Modelos que el producto ya trae (porción model3d.files, p. ej. el producto de ejemplo). */
export function ownFiles(state: Pick<Model3DState, 'files'>): Model3DFile[] {
  return asArray<Model3DFile>(state.files).filter(file => !!file && !!file.url && !!file.key);
}

/** Si el archivo es el modelo abierto en el visor (por URL o, si cambió la URL, por su key; E21). */
export function isFileSelected(file: Model3DFile, state: Pick<Model3DState, 'selected3DModel' | 'selectedKey'>): boolean {
  return !!state.selected3DModel && (file.url === state.selected3DModel || (!!state.selectedKey && file.key === state.selectedKey));
}

/** Metadatos del archivo abierto (tarjetas Polígonos / Texturas / Formato / Tamaño). */
export function selectedMetadata(files: Model3DFile[], state: Pick<Model3DState, 'selected3DModel' | 'selectedKey'>): Model3DMetadata | null {
  return files.find(file => isFileSelected(file, state))?.metadata ?? null;
}

/** Cambio que deshace una selección (el visor deja de mostrar el modelo). */
export const CLEAR_SELECTION: Readonly<Model3DPatch> = Object.freeze({
  selected3DModel: null,
  selectedKey: null,
  modelQualityInfo: null,
});

/**
 * Lo que el original pierde al recargar la página: blob: URLs y una generación
 * en curso. Devuelve el cambio a guardar al montar la pestaña, o null.
 */
export function staleStatePatch(
  state: Model3DState,
  { isDeadBlob, hasActiveGeneration }: { isDeadBlob: (url: unknown) => boolean; hasActiveGeneration: boolean },
): Model3DPatch | null {
  const patch: Model3DPatch = {};
  if (isDeadBlob(state.selected3DModel)) Object.assign(patch, CLEAR_SELECTION);
  if (state.isGenerating3D && !hasActiveGeneration) Object.assign(patch, { isGenerating3D: false, generation3DProgress: 0 });
  return Object.keys(patch).length ? patch : null;
}

/** El bloque del modelo se muestra con un modelo abierto, una generación o archivos listados. */
export function showsModelBlock(state: Model3DState, listed: number): boolean {
  return !!(state.selected3DModel || state.isGenerating3D || listed > 0);
}
