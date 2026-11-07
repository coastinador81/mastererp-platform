import { Platform, useWindowDimensions } from 'react-native';
import { contentWidth } from './theme';

/** Ancho efectivo de la UI: en web se limita al shell móvil centrado. */
export function useLayoutWidth() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' ? Math.min(width, contentWidth) : width;
}
