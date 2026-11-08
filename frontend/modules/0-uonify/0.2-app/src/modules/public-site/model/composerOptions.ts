/**
 * Opciones de IA del compositor de la portada (composer-tools.js del prototipo):
 * modelo, esfuerzo de razonamiento y velocidad. Se guardan en sessionStorage con la
 * misma clave que el espacio de trabajo para que la elección se conserve al entrar.
 */
export interface ComposerModel {
  id: string;
  label: string;
  short?: string;
  detail?: string;
  /** Esfuerzo máximo que admite el modelo (por defecto, todos). */
  maxEffort?: EffortId;
}

export type EffortId = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Speed = 'standard' | 'fast';

export interface ComposerEffort { id: EffortId; label: string }

export interface ComposerPreferences { model: string; effort: EffortId; speed: Speed }

export const COMPOSER_PREFERENCES_KEY = 'uonify-composer-preferences';
export const DISMISSED_SUGGESTIONS_KEY = 'uonify-composer-dismissed-suggestions';

export const COMPOSER_MODELS: readonly ComposerModel[] = [
  { id: 'auto', label: 'Auto', detail: 'Conjunto recomendado de modelos' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', short: '6 Astra' },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol', short: '6 Sol' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', short: '6 Luna' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', short: '5.6 Sol' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', short: '5.6 Terra' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', short: '5.6 Luna' },
  { id: 'gpt-5.5', label: 'GPT-5.5', short: '5.5', maxEffort: 'xhigh' },
];

export const COMPOSER_EFFORTS: readonly ComposerEffort[] = [
  { id: 'low', label: 'Bajo' },
  { id: 'medium', label: 'Medio' },
  { id: 'high', label: 'Alto' },
  { id: 'xhigh', label: 'Muy alto' },
  { id: 'max', label: 'Ultra' },
];

export const DEFAULT_PREFERENCES: ComposerPreferences = { model: 'auto', effort: 'medium', speed: 'standard' };

export function findModel(id: string): ComposerModel {
  return COMPOSER_MODELS.find(model => model.id === id) ?? COMPOSER_MODELS[0];
}

export function findEffort(id: string): ComposerEffort {
  return COMPOSER_EFFORTS.find(effort => effort.id === id) ?? COMPOSER_EFFORTS[1];
}

/** Índice del esfuerzo más alto que admite el modelo. */
export function maxEffortIndex(modelId: string): number {
  const model = findModel(modelId);
  return model.maxEffort ? COMPOSER_EFFORTS.findIndex(effort => effort.id === model.maxEffort) : COMPOSER_EFFORTS.length - 1;
}

/** Esfuerzos visibles para el modelo (GPT-5.5 se queda en «Muy alto»). */
export function effortsFor(modelId: string): readonly ComposerEffort[] {
  return COMPOSER_EFFORTS.slice(0, maxEffortIndex(modelId) + 1);
}

/** Ajusta el esfuerzo al máximo del modelo, como updatePicker() del PROTO. */
export function clampEffort(modelId: string, effort: EffortId): EffortId {
  const max = maxEffortIndex(modelId);
  const index = COMPOSER_EFFORTS.findIndex(item => item.id === effort);
  return index > max ? COMPOSER_EFFORTS[max].id : effort;
}

/** Normaliza lo guardado (valores desconocidos vuelven al valor por defecto). */
export function normalizePreferences(saved: unknown): ComposerPreferences {
  const value = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof ComposerPreferences, unknown>>;
  const model = COMPOSER_MODELS.some(item => item.id === value.model) ? String(value.model) : DEFAULT_PREFERENCES.model;
  const effort = COMPOSER_EFFORTS.some(item => item.id === value.effort) ? (value.effort as EffortId) : DEFAULT_PREFERENCES.effort;
  const speed: Speed = value.speed === 'fast' ? 'fast' : 'standard';
  return { model, effort: clampEffort(model, effort), speed };
}

/** Nombre accesible del botón de velocidad según el estado. */
export function speedLabel(speed: Speed): string {
  return speed === 'fast'
    ? 'Desactivar modo rápido y volver a velocidad normal'
    : 'Activar modo rápido: 1,5 veces más velocidad y mayor consumo';
}

/** Límite de tamaño por archivo adjunto (10 MB, como el PROTO). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const PHOTO_ACCEPT = 'image/*';
export const FILE_ACCEPT = '.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,image/*';

/** Separa los archivos admitidos de los que superan el límite. */
export function splitAttachments(files: readonly File[]): { accepted: File[]; rejected: File[] } {
  const accepted: File[] = [];
  const rejected: File[] = [];
  files.forEach(file => (file.size > MAX_ATTACHMENT_BYTES ? rejected : accepted).push(file));
  return { accepted, rejected };
}

/** Texto que deja «Crear una imagen» en el compositor. */
export const CREATE_IMAGE_PREFIX = 'Crea una imagen de ';
