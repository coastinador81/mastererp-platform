import type { ReactNode } from 'react';
import { uid } from '@/shared/lib';

/**
 * Avisos al estilo sonner (prototipo: pim/core.js, `toast`): arriba a la derecha,
 * apilados (el último arriba), se cierran solos a los 4 s; «loading» se queda
 * hasta que se sustituye o se cierra. Con el mismo `id` se actualiza el aviso en
 * su sitio (p. ej. «Generando…» → «Listo»). Es imperativo y funciona fuera de
 * React; <Toaster/> (montado en AppProviders) lo pinta.
 */
export type ToastType = 'default' | 'success' | 'error' | 'warning' | 'info' | 'loading';
export type ToastId = string | number;

export interface ToastOptions {
  id?: ToastId;
  description?: ReactNode;
  /** Milisegundos; Infinity no lo cierra. Por defecto 4000 (loading: Infinity). */
  duration?: number;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  message: ReactNode;
  description?: ReactNode;
}

export const TOAST_DURATION = 4000;

let items: ToastItem[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

function show(type: ToastType, message: ReactNode, options: ToastOptions = {}): ToastId {
  const given = options.id;
  const id = String(given ?? uid('toast'));
  clearTimer(id);
  const item: ToastItem = { id, type, message, description: options.description };
  const index = items.findIndex(existing => existing.id === id);
  items = index >= 0 ? items.map((existing, i) => (i === index ? item : existing)) : [item, ...items];
  const duration = options.duration ?? (type === 'loading' ? Infinity : TOAST_DURATION);
  if (Number.isFinite(duration)) timers.set(id, setTimeout(() => dismiss(id), duration));
  emit();
  return given ?? id;
}

/** Cierra un aviso, o todos si no se da `id`. */
function dismiss(id?: ToastId): void {
  if (id === undefined) {
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
    if (!items.length) return;
    items = [];
    emit();
    return;
  }
  const key = String(id);
  clearTimer(key);
  if (!items.some(item => item.id === key)) return;
  items = items.filter(item => item.id !== key);
  emit();
}

type Show = (message: ReactNode, options?: ToastOptions) => ToastId;

export interface ToastApi extends Show {
  success: Show;
  error: Show;
  warning: Show;
  info: Show;
  loading: Show;
  dismiss: (id?: ToastId) => void;
}

/**
 * `toast('Guardado')`, `toast.success('Listo', { description })`,
 * `const id = toast.loading('Generando…'); toast.success('Hecho', { id })`,
 * `toast.dismiss(id)`.
 */
export const toast: ToastApi = Object.assign(
  (message: ReactNode, options?: ToastOptions) => show('default', message, options),
  {
    success: (message: ReactNode, options?: ToastOptions) => show('success', message, options),
    error: (message: ReactNode, options?: ToastOptions) => show('error', message, options),
    warning: (message: ReactNode, options?: ToastOptions) => show('warning', message, options),
    info: (message: ReactNode, options?: ToastOptions) => show('info', message, options),
    loading: (message: ReactNode, options?: ToastOptions) => show('loading', message, options),
    dismiss,
  },
);

/** Suscripción para <Toaster/> (useSyncExternalStore). */
export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Avisos visibles, el más reciente primero (referencia estable hasta que cambian). */
export function getToasts(): ToastItem[] {
  return items;
}
