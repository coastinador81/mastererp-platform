import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import clsx from 'clsx';
import type { PimTabDefinition } from '../tabs';
import type { PimTabContext } from './types';

/** Contexto React de la pestaña montada (lo da el módulo catalog). */
export const PimTabReactContext = createContext<PimTabContext | null>(null);

export function PimTabProvider({ value, children }: { value: PimTabContext; children: ReactNode }) {
  return <PimTabReactContext.Provider value={value}>{children}</PimTabReactContext.Provider>;
}

/** El contexto de la pestaña; falla si se usa fuera de una ficha. */
export function useTabContext(): PimTabContext {
  const context = useContext(PimTabReactContext);
  if (!context) throw new Error('useTabContext: la pestaña debe montarse dentro de <PimTabProvider> (ficha de producto).');
  return context;
}

/** El contexto de la pestaña o null (componentes que también viven fuera de la ficha). */
export function useOptionalTabContext(): PimTabContext | null {
  return useContext(PimTabReactContext);
}

export interface PimTabHostProps extends Omit<ComponentProps<'div'>, 'children'> {
  tab: PimTabDefinition;
  context: PimTabContext;
}

/**
 * Monta una pestaña con su contexto dentro de `div.pim-tab.pim-tab-<clave>`
 * (las clases que el prototipo añadía al anfitrión en UonifyPIM.mount).
 * Quien lo usa decide la `key` de React: cambiarla vuelve a montar la pestaña.
 */
export function PimTabHost({ tab, context, className, ...rest }: PimTabHostProps) {
  const Tab = tab.component;
  return (
    <PimTabProvider value={context}>
      <div className={clsx('pim-tab', `pim-tab-${tab.key}`, className)} {...rest}>
        <Tab />
      </div>
    </PimTabProvider>
  );
}
