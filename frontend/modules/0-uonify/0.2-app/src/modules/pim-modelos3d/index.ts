/**
 * Módulo pim-modelos3d: pestaña «3D» de la ficha de producto (prototipo:
 * pim/modelos3d.js y pim/modelos3d.css). Puerta única del módulo.
 * Importarlo registra sus iconos (m3d-*) y carga sus hojas.
 */
import '@/shared/ui';
import './icons';
import './styles/index.css';
import type { PimTabDefinition } from '@/shared/pim';
import { Modelos3DTab } from './components/Modelos3DTab';

/** Definición de la pestaña (clave 'modelos3d', etiqueta «3D», icono del prototipo). */
export const tab: PimTabDefinition = { key: 'modelos3d', label: '3D', icon: 'package', component: Modelos3DTab };

/** Alias con nombre propio, por si catalog reúne varias pestañas en un mismo archivo. */
export const modelos3dTab = tab;

export { Modelos3DTab };
export type { Model3DFile, Model3DMetadata, Model3DState } from './model/types';
