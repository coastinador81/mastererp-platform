import { useSyncExternalStore } from 'react';

const subscribeNoop = () => () => {};

/**
 * ¿Se pinta en el navegador? false al prerenderizar (el HTML estático, que la puerta de
 * DEV sirve también sin JS) y true en la aplicación desde su primer pintado: la app monta
 * con createRoot, sin hidratar, así que no hay desajuste ni parpadeo. Sirve para pintar
 * sin JS una versión estática (pestañas legales por :target, idioma como etiqueta fija).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}
