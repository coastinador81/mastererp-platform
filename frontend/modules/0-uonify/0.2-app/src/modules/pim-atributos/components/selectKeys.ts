import type { KeyboardEvent } from 'react';

/**
 * «Stock» y «Tipo de Campo» eran Selects de Radix en el original: las flechas
 * abren la lista y el valor solo cambia al elegirlo. Un select nativo cerrado
 * lo cambia con cada flecha, Re Pág, Av Pág, Inicio o Fin (y el de stock
 * llamaría a EDI cada vez). Radix conserva la búsqueda por letra en el
 * disparador; solo el de stock, cuyas opciones empiezan por ✓/✗, la quita.
 * Espacio, Intro, Alt+↓ y F4 siguen abriendo la lista nativa.
 */
export function radixSelectKeys(event: KeyboardEvent<HTMLSelectElement>, { typeahead }: { typeahead: boolean }): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const select = event.currentTarget;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (typeof select.showPicker !== 'function') return; // sin la API: lo que haga el navegador
    event.preventDefault();
    try {
      select.showPicker();
    } catch {
      /* Espacio / Alt+↓ la siguen abriendo */
    }
  } else if (['PageUp', 'PageDown', 'Home', 'End'].includes(event.key) || (!typeahead && event.key.length === 1 && event.key !== ' ')) {
    event.preventDefault();
  }
}
