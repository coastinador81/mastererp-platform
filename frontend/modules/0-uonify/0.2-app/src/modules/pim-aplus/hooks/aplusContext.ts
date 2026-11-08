import { createContext, useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useLatest } from '@/shared/hooks';
import { useTabContext } from '@/shared/pim';
import { AplusController } from './aplusController';
import type { AplusState } from './aplusStore';

/** El controlador de la pestaña montada, para sus componentes. */
export const AplusControllerContext = createContext<AplusController | null>(null);

export function useAplusController(): AplusController {
  const controller = useContext(AplusControllerContext);
  if (!controller) throw new Error('useAplusController: fuera de la pestaña A+.');
  return controller;
}

/** Lee una parte del estado de la pestaña (vuelve a pintar solo si cambia). */
export function useAplus<T>(selector: (state: AplusState) => T): T {
  return useStore(useAplusController().store, selector);
}

const asinOf = (product: Record<string, unknown> | null): string | undefined =>
  typeof product?.asin === 'string' && product.asin.trim() ? product.asin.trim() : undefined;

/**
 * Crea el controlador con el contexto de la ficha y lo arranca mientras la
 * pestaña está montada (cada montaje empieza sin módulos: A01).
 */
export function useAplusSetup(): AplusController {
  const ctx = useTabContext();
  const latest = useLatest(ctx);
  const [controller] = useState(() => new AplusController({
    asin: asinOf(ctx.product),
    scope: ctx.store,
    source: () => ({ product: latest.current.product, draft: () => latest.current.draft() as Record<string, unknown> }),
  }));
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  return controller;
}
