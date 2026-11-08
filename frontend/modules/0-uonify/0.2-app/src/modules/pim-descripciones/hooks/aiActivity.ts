import { useSyncExternalStore } from 'react';
import { iconHTML } from '@/shared/ui';

/**
 * «aiActive» y el indicador flotante «Generando...» (prototipo:
 * pim/descripciones.js; original: useDescriptionsIA.handleAiGenerate e
 * indicador de ProductsPIMInterface.tsx). Vivían por encima de la pestaña: el
 * resaltado dura 2 s (setTimeout que no se cancela, independiente de la
 * petición) y sobrevive a un cambio de pestaña. Por eso el indicador se pinta
 * fuera del árbol de React, en <body>, como en el prototipo.
 */
export const AI_ACTIVE_MS = 2000;

let activeField: string | null = null;
let indicator: HTMLElement | null = null;
const listeners = new Set<() => void>();

function renderIndicator(show: boolean): void {
  if (typeof document === 'undefined') return;
  const current = indicator;
  if (show) {
    if (current) return;
    const badge = document.createElement('div');
    badge.className = 'pim-descripciones-indicator';
    badge.setAttribute('role', 'status');
    // Marcado propio (icono del registro + texto fijo), nunca datos del usuario.
    badge.innerHTML = `${iconHTML('sparkles', 16, 'pim-spin')}<span>Generando...</span>`;
    document.body.appendChild(badge);
    indicator = badge;
    return;
  }
  if (!current) return;
  indicator = null;
  current.classList.add('is-leaving');
  const remove = () => current.remove();
  current.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 400);
}

function emit(): void {
  listeners.forEach(listener => listener());
  renderIndicator(activeField !== null);
}

/** handleAiGenerate: resalta el campo 2 s y enseña «Generando...». */
export function handleAiGenerate(field: string): void {
  activeField = field;
  emit();
  setTimeout(() => {
    activeField = null;
    emit();
  }, AI_ACTIVE_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Campo resaltado ahora mismo (o null). */
export function useAiActiveField(): string | null {
  return useSyncExternalStore(subscribe, () => activeField, () => null);
}
