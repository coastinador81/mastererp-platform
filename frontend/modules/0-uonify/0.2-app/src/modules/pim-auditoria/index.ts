/**
 * Módulo pim-auditoria: pestaña «Auditoría IA» de la ficha de producto
 * (prototipo: pim/auditoria.js y pim/auditoria.css). Única puerta de entrada.
 *
 * Porciones del almacén: escribe `audit`; con «Aplicar» escribe `customFields`,
 * `images` y, con ctx.edit(), los campos básicos del producto (nombre, SKU, marca,
 * categoría, descripción, precio).
 * Backend: POST /ai-audit y POST /product-scraper (ver api/auditApi.ts y mocks/handlers.ts).
 */
import type { PimTabDefinition } from '@/shared/pim';
import { AuditoriaTab } from './components/AuditoriaTab';

export const tab: PimTabDefinition = {
  key: 'auditoria',
  label: 'Auditoría IA',
  // En el prototipo solo GPSR, 3D, Vídeo y A+ llevan icono en la pestaña.
  icon: null,
  component: AuditoriaTab,
};

/** Alias con nombre propio (como gpsrTab en el README de shared/pim). */
export const auditoriaTab = tab;

export { AuditoriaTab };
export { AUDIT_ENDPOINTS } from './api/auditApi';
export type { AuditState, AuditResult, ScrapedProduct } from './model/types';
