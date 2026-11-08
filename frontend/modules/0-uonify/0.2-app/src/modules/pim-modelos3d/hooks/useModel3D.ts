import { useCallback, useLayoutEffect, useMemo } from 'react';
import { usePimValue, useTabContext, type PimScope } from '@/shared/pim';
import { activeGenerations, isDeadBlob } from '../model/pageState';
import { merge3D, normalize3D, staleStatePatch } from '../model/state';
import type { Model3DPatch, Model3DState } from '../model/types';

/** Escribe un cambio en la porción `model3d` (set3D del prototipo). */
export function write3D(scope: PimScope, patch: Model3DPatch): void {
  scope.update<Model3DState | Record<string, never>>('model3d', saved => merge3D(saved, patch), {});
}

/** Lee la porción `model3d` ya normalizada (get3D del prototipo). */
export const read3D = (scope: PimScope): Model3DState => normalize3D(scope.get('model3d', null));

export interface Model3DStore {
  state: Model3DState;
  /** Estado actual del almacén (para manejadores que acaban tarde). */
  get3D: () => Model3DState;
  set3D: (patch: Model3DPatch) => void;
  scope: PimScope;
}

/**
 * Porción `model3d` del producto de la pestaña. Al montar descarta lo que no
 * sobrevive a una recarga (blob: URLs de otra carga y una generación que ya no corre).
 */
export function useModel3D(): Model3DStore {
  const ctx = useTabContext();
  const scope = ctx.store;
  const raw = usePimValue<unknown>(ctx.key, 'model3d', null);
  const state = useMemo(() => normalize3D(raw), [raw]);
  const get3D = useCallback(() => read3D(scope), [scope]);
  const set3D = useCallback((patch: Model3DPatch) => write3D(scope, patch), [scope]);

  useLayoutEffect(() => {
    const patch = staleStatePatch(read3D(scope), { isDeadBlob, hasActiveGeneration: activeGenerations.has(ctx.key) });
    if (patch) write3D(scope, patch);
  }, [scope, ctx.key]);

  return { state, get3D, set3D, scope };
}
