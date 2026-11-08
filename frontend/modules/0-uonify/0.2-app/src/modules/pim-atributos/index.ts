/**
 * Módulo pim-atributos: pestaña «Atributos» de la ficha de producto (prototipo:
 * pim/atributos.js y pim/atributos.css). Puerta única del módulo.
 * Al importarlo registra el publicador de Amazon y los campos personalizados
 * por defecto en @/shared/pim (ver register.ts).
 */
import type { PimTabDefinition } from '@/shared/pim';
import { AtributosTab } from './components/AtributosTab';
import './register';

export const tab: PimTabDefinition = { key: 'atributos', label: 'Atributos', icon: null, component: AtributosTab };
export const atributosTab = tab;

export { publishToAmazon } from './api/amazonPublisher';
export { defaultCustomFields, generateCustomFields } from './model/customFields';
export { mapInternalToAmazon, gpsrFields } from './model/productMapper';
export type { CustomField, FieldType } from './model/types';
