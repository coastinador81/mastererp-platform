import type { ComponentType } from 'react';

/**
 * Pestañas de la ficha de producto (prototipo: app-shell.js, PIM_TABS y la
 * lista de pestañas de la ficha). Cada módulo pim-* exporta desde su index.ts
 * una PimTabDefinition; el módulo catalog las reúne en este orden.
 */
export const PIM_TAB_ORDER = ['atributos', 'auditoria', 'descripciones', 'gpsr', 'imagenes', 'modelos3d', 'video', 'aplus', 'incidencias'] as const;

export type PimTabKey = (typeof PIM_TAB_ORDER)[number];

/** Alias con el nombre del prototipo. */
export const PIM_TABS = PIM_TAB_ORDER;

/** Etiquetas visibles de las pestañas (las mismas que el prototipo). */
export const PIM_TAB_LABELS: Record<PimTabKey, string> = {
  atributos: 'Atributos',
  auditoria: 'Auditoría IA',
  descripciones: 'Descripciones',
  gpsr: 'GPSR',
  imagenes: 'Imágenes',
  modelos3d: '3D',
  video: 'Vídeo',
  aplus: 'A+',
  incidencias: 'Incidencias',
};

export interface PimTabDefinition {
  key: PimTabKey;
  label: string;
  /**
   * Icono junto a la etiqueta (nombre del registro de @/shared/ui). En el prototipo
   * solo lo llevan GPSR, 3D, Vídeo y A+; `null` = sin icono.
   */
  icon: string | null;
  /** La pestaña; lee su contexto con useTabContext() y sus datos con usePimSlice(). */
  component: ComponentType;
}

export function isPimTabKey(value: unknown): value is PimTabKey {
  return typeof value === 'string' && (PIM_TAB_ORDER as readonly string[]).includes(value);
}

/** Ordena definiciones según PIM_TAB_ORDER (y quita duplicados por clave). */
export function sortPimTabs(definitions: PimTabDefinition[]): PimTabDefinition[] {
  const byKey = new Map<PimTabKey, PimTabDefinition>();
  definitions.forEach(definition => {
    if (isPimTabKey(definition.key) && !byKey.has(definition.key)) byKey.set(definition.key, definition);
  });
  return PIM_TAB_ORDER.flatMap(key => {
    const definition = byKey.get(key);
    return definition ? [definition] : [];
  });
}
