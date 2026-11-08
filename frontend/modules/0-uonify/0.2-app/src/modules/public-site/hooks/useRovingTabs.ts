import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { nextTabIndex } from '../model/tabs';

interface RovingTab {
  role: 'tab';
  'aria-selected': boolean;
  tabIndex: number;
  ref: (node: HTMLButtonElement | null) => void;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * Pestañas con foco itinerante (una sola en el orden de tabulación), como las
 * del PROTO. `onSelect` permite reaccionar al cambio (p. ej. cargar el visor 3D).
 */
export function useRovingTabs<K extends string>(keys: readonly K[], initial: K, onSelect?: (key: K) => void) {
  const [selected, setSelected] = useState<K>(initial);
  const nodes = useRef(new Map<K, HTMLButtonElement>());

  const select = useCallback((key: K, focus = false) => {
    setSelected(key);
    onSelect?.(key);
    if (focus) nodes.current.get(key)?.focus();
  }, [onSelect]);

  const tabProps = (key: K): RovingTab => ({
    role: 'tab',
    'aria-selected': key === selected,
    tabIndex: key === selected ? 0 : -1,
    ref: node => { if (node) nodes.current.set(key, node); else nodes.current.delete(key); },
    onClick: () => select(key),
    onKeyDown: event => {
      const next = nextTabIndex(event.key, keys.indexOf(key), keys.length);
      if (next === undefined) return;
      event.preventDefault();
      select(keys[next], true);
    },
  });

  return { selected, select, tabProps };
}
