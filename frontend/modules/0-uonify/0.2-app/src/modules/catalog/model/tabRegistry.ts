import { isPimTabKey, sortPimTabs, type PimTabDefinition } from '@/shared/pim';

/**
 * Pestañas de la ficha sin importarlas a mano: cada módulo pim-* exporta desde su
 * index.ts su `tab: PimTabDefinition` (o cualquier exportación con esa forma) y aquí
 * se reúnen en el orden de PIM_TAB_ORDER. Añadir una pestaña no toca este módulo.
 */
function isTabDefinition(value: unknown): value is PimTabDefinition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PimTabDefinition>;
  return isPimTabKey(candidate.key) && typeof candidate.label === 'string' && Boolean(candidate.component);
}

/** Definiciones encontradas en los módulos cargados (orden de PIM_TAB_ORDER, sin repetidas). */
export function collectTabs(modules: Record<string, Record<string, unknown>>): PimTabDefinition[] {
  const found = Object.values(modules).flatMap(exports => {
    if (isTabDefinition(exports.tab)) return [exports.tab];
    return Object.values(exports).filter(isTabDefinition);
  });
  return sortPimTabs(found);
}
