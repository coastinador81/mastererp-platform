import type { PimTabDefinition } from '@/shared/pim';
import { collectTabs } from './model/tabRegistry';

/**
 * Pestañas de la ficha: se reúnen solas de los módulos pim-* (su index.ts exporta
 * `tab: PimTabDefinition`), sin importaciones fijas, en el orden de PIM_TAB_ORDER.
 */
const modules = import.meta.glob<Record<string, unknown>>('../pim-*/index.ts', { eager: true });

export const PIM_TAB_DEFINITIONS: PimTabDefinition[] = collectTabs(modules);
