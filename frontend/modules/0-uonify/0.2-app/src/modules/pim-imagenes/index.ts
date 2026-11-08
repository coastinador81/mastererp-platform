/**
 * Módulo pim-imagenes: pestaña «Imágenes» de la ficha de producto (clave
 * 'imagenes'). Puerta única del módulo. Origen: pim/imagenes.js y
 * pim/imagenes.css del prototipo.
 *
 * Porciones del almacén del producto que escribe (las leen 3D, A+ y el guardado):
 *   'images'           galería completa (subidas, scrapeadas, del producto, Amazon, IA y procesadas)
 *   'processedImages'  redimensionadas a 1500 × 1500
 *   'aiImages'         generadas por Uony
 *   'deletedImageUrls' URLs quitadas de las imágenes del producto
 * Rutas del backend: api/endpoints.ts (simuladas en mocks/handlers.ts).
 */
import type { PimTabDefinition } from '@/shared/pim';
import { ImagenesTab } from './components/ImagenesTab';

export const tab: PimTabDefinition = {
  key: 'imagenes',
  label: 'Imágenes',
  // En el prototipo solo GPSR, 3D, Vídeo y A+ llevan icono.
  icon: null,
  component: ImagenesTab,
};

export { tab as imagenesTab };
export { IMAGES_ENDPOINTS } from './api/endpoints';
export type { ImageItem, ImageSource, ImageStatus } from './model/types';
