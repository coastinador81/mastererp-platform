/**
 * Módulo pim-aplus: pestaña «A+» (Contenido A+) de la ficha de producto.
 * Puerto de pim/aplus.js y pim/aplus.css del prototipo. Única puerta pública.
 *
 * Datos: porción `aplus` del almacén por producto (caché de 30 min por ASIN; sin
 * ASIN, en 'local' y sin caducidad) y, para productos de Amazon, las rutas
 * /amazon/aplus/* y POST /ai-aplus (simuladas en mocks/handlers.ts).
 */
import type { PimTabDefinition } from '@/shared/pim';
import { AplusTab } from './components/AplusTab';

export const tab: PimTabDefinition = { key: 'aplus', label: 'A+', icon: 'sparkles', component: AplusTab };

/** Alias con nombre propio (mismo objeto que `tab`). */
export const aplusTab = tab;

export { AplusTab };
export { APLUS_ENDPOINTS } from './api/aplusApi';
export type { AplusModule, AplusSlice, AplusImage, ModuleType } from './model/types';

export { AplusPreviewBody } from './components/dialogs/PreviewDialog';
