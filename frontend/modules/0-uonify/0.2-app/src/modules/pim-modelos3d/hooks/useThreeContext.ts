import { useSyncExternalStore } from 'react';
import { threeContext } from '../model/threeContext';

/** Vuelve a pintar cuando cambia el registro de canvas (límite de 3 visores). */
export function useThreeContextVersion(): number {
  return useSyncExternalStore(threeContext.subscribe, threeContext.version, threeContext.version);
}
