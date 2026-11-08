/**
 * Módulo pim-descripciones: pestaña «Descripciones» de la ficha de producto
 * (prototipo: pim/descripciones.js y pim/descripciones.css). Puerta única del módulo.
 */
import type { PimTabDefinition } from '@/shared/pim';
import { DescripcionesTab } from './components/DescripcionesTab';

export const tab: PimTabDefinition = { key: 'descripciones', label: 'Descripciones', icon: null, component: DescripcionesTab };
export const descripcionesTab = tab;

export { textToHtml } from './model/text';
