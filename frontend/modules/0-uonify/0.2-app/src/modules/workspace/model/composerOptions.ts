/**
 * Opciones de IA del compositor (composer-tools.js): modelo, esfuerzo de
 * razonamiento (incluido Ultra) y velocidad (modo rápido 1,5×). La lista es una
 * configuración del frontend; no presupone disponibilidad real en el backend.
 */
export interface ModelOption {
  id: string;
  label: string;
  /** Nombre corto de la fila del espacio de trabajo (el menú y el nombre accesible usan el completo). */
  short?: string;
  detail?: string;
  /** Esfuerzo máximo que admite (por defecto, todos). */
  maxEffort?: EffortId;
}

export type EffortId = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Speed = 'standard' | 'fast';

export const MODELS: ModelOption[] = [
  { id: 'auto', label: 'Auto', detail: 'Conjunto recomendado de modelos' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', short: '6 Astra' },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol', short: '6 Sol' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', short: '6 Luna' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', short: '5.6 Sol' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', short: '5.6 Terra' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', short: '5.6 Luna' },
  { id: 'gpt-5.5', label: 'GPT-5.5', short: '5.5', maxEffort: 'xhigh' },
];

export const EFFORTS: { id: EffortId; label: string }[] = [
  { id: 'low', label: 'Bajo' },
  { id: 'medium', label: 'Medio' },
  { id: 'high', label: 'Alto' },
  { id: 'xhigh', label: 'Muy alto' },
  { id: 'max', label: 'Ultra' },
];

export interface AiPreferences {
  model: string;
  effort: EffortId;
  speed: Speed;
}

export const PREFERENCES_KEY = 'uonify-composer-preferences';
export const DISMISSED_SUGGESTIONS_KEY = 'uonify-composer-dismissed-suggestions';

const modelIds = new Set(MODELS.map(model => model.id));
const effortIds = new Set<string>(EFFORTS.map(effort => effort.id));

export function findModel(id: string): ModelOption {
  return MODELS.find(model => model.id === id) ?? MODELS[0];
}

/** Índice del último esfuerzo que admite el modelo. */
export function maxEffortIndex(modelId: string): number {
  const model = findModel(modelId);
  return model.maxEffort ? EFFORTS.findIndex(effort => effort.id === model.maxEffort) : EFFORTS.length - 1;
}

/** GPT-5.5 se queda en «Muy alto»: Ultra desaparece y la elección baja un nivel. */
export function clampEffort(modelId: string, effort: EffortId): EffortId {
  const max = maxEffortIndex(modelId);
  return EFFORTS.findIndex(item => item.id === effort) > max ? EFFORTS[max].id : effort;
}

export function effortLabel(effort: EffortId): string {
  return (EFFORTS.find(item => item.id === effort) ?? EFFORTS[1]).label;
}

export function normalizePreferences(saved: unknown): AiPreferences {
  const value = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {};
  const model = typeof value.model === 'string' && modelIds.has(value.model) ? value.model : 'auto';
  const effort = typeof value.effort === 'string' && effortIds.has(value.effort) ? (value.effort as EffortId) : 'medium';
  return { model, effort: clampEffort(model, effort), speed: value.speed === 'fast' ? 'fast' : 'standard' };
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(sessionStorage.getItem(key) || 'null') as T) || fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Los controles siguen funcionando en esta carga de la página. */
  }
}

/** Límite de cada adjunto del «+» del compositor. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/**
 * Decisión del dueño (22-10-2026, «Ocultar hasta que funcione»): Uony aún no recibe
 * archivos por la caja, así que «Añadir fotos» y «Añadir archivos» no se ofrecen.
 * Pasa a true cuando exista la subida real; mientras, los archivos se usan desde Drive.
 */
export const FILE_UPLOADS_READY = false;
