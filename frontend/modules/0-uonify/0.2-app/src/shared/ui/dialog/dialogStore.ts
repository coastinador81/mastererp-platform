import { uid } from '@/shared/lib';
import type { ConfirmOptions, DialogControls, DialogHandle, DialogOptions } from './types';

/**
 * Diálogos imperativos (prototipo: pim/core.js, `dialog.open` y `dialog.confirm`,
 * equivalentes al Dialog y AlertDialog de Radix del original): modales, Escape y
 * la X los cierran y el foco vuelve a quien los abrió. Funciona fuera de React;
 * <DialogHost/> (montado en AppProviders) los pinta.
 */
export interface DialogEntry {
  id: string;
  options: DialogOptions;
  /** Elemento con el foco al abrir: lo recupera al cerrar. */
  opener: HTMLElement | null;
  controls: DialogControls;
}

let entries: DialogEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

function closeDialog(id: string, result?: unknown): void {
  const entry = entries.find(item => item.id === id);
  if (!entry) return;
  entries = entries.filter(item => item.id !== id);
  emit();
  entry.options.onClose?.(result);
}

function updateDialog(id: string, patch: Partial<DialogOptions>): void {
  if (!entries.some(item => item.id === id)) return;
  entries = entries.map(item => (item.id === id ? { ...item, options: { ...item.options, ...patch } } : item));
  emit();
}

function openDialog(options: DialogOptions): DialogHandle {
  const id = uid('dialog');
  const active = typeof document === 'undefined' ? null : document.activeElement;
  const opener = active instanceof HTMLElement && active !== document.body ? active : null;
  const controls: DialogControls = {
    close: result => closeDialog(id, result),
    update: patch => updateDialog(id, patch),
  };
  entries = [...entries, { id, options: { size: 'md', dismissible: true, ...options }, opener, controls }];
  emit();
  return { id, ...controls };
}

/** Pregunta de sí o no; resuelve `true` solo con la acción de confirmar. */
function confirmDialog({
  title,
  description = '',
  confirmLabel = 'Continuar',
  cancelLabel = 'Cancelar',
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    openDialog({
      title,
      description,
      size: 'sm',
      dismissible: true,
      actions: [
        { label: cancelLabel, variant: 'outline', value: false },
        { label: confirmLabel, variant: destructive ? 'danger' : 'primary', value: true },
      ],
      onClose: result => resolve(result === true),
    });
  });
}

export const dialog = {
  /** Abre un diálogo; devuelve { id, close(result), update(patch) }. */
  open: openDialog,
  /** Confirmación (AlertDialog): Promise<boolean>. */
  confirm: confirmDialog,
  /** Cierra un diálogo por id (o todos sin id), con el resultado dado. */
  close(id?: string, result?: unknown): void {
    if (id !== undefined) closeDialog(id, result);
    else [...entries].reverse().forEach(entry => closeDialog(entry.id, result));
  },
};

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Diálogos abiertos, del más antiguo al más reciente. */
export function getDialogs(): DialogEntry[] {
  return entries;
}
