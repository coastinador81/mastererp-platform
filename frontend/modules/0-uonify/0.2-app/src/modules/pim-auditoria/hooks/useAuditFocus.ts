import { createContext, useCallback, useContext, useEffect, useState, type RefObject } from 'react';

/**
 * Foco gestionado de la pestaña, como el original: tras una acción que quita o
 * deshabilita el control con foco, este pasa al siguiente lógico. Los controles se
 * marcan con `data-focus="clave"`; el foco se mueve después de pintar.
 */
export interface FocusOptions {
  /** Solo si el foco se ha perdido (está en <body>). */
  onlyIfLost?: boolean;
}

export type RequestFocus = (keys: string | string[], options?: FocusOptions) => void;

export const AuditFocusContext = createContext<RequestFocus>(() => {});

/** Pide mover el foco a la primera clave presente y habilitada. */
export const useAuditFocus = (): RequestFocus => useContext(AuditFocusContext);

/** El foco se ha perdido (el control que lo tenía desapareció o se deshabilitó). */
export const focusLost = (): boolean => !document.activeElement || document.activeElement === document.body;

/** Elemento con `data-focus` igual a `key` dentro de `root`. */
export function findByFocus(root: ParentNode | null | undefined, key: string): HTMLElement | null {
  if (!root) return null;
  return [...root.querySelectorAll<HTMLElement>('[data-focus]')].find(node => node.getAttribute('data-focus') === key) ?? null;
}

const isDisabled = (node: HTMLElement): boolean => 'disabled' in node && Boolean((node as HTMLButtonElement).disabled);

interface PendingFocus {
  seq: number;
  keys: string[];
  onlyIfLost: boolean;
}

/** Gestor del foco de la raíz de la pestaña (lo provee AuditoriaTab). */
export function useFocusManager(rootRef: RefObject<HTMLElement | null>): RequestFocus {
  const [pending, setPending] = useState<PendingFocus | null>(null);
  const requestFocus = useCallback<RequestFocus>((keys, options) => {
    setPending(previous => ({
      seq: (previous?.seq ?? 0) + 1,
      keys: Array.isArray(keys) ? keys : [keys],
      onlyIfLost: Boolean(options?.onlyIfLost),
    }));
  }, []);
  useEffect(() => {
    if (!pending) return;
    if (pending.onlyIfLost && !focusLost()) return;
    for (const key of pending.keys) {
      const node = findByFocus(rootRef.current, key);
      if (node && !isDisabled(node)) {
        node.focus({ preventScroll: false });
        return;
      }
    }
  }, [pending, rootRef]);
  return requestFocus;
}
