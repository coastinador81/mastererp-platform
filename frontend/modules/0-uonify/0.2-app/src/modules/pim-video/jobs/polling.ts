import type { PimScope } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { getProject } from '../api/videoApi';
import { ACTIVE, POLL_MS } from '../model/constants';
import { httpStatus, libraryVideoFromProject, projectFrom, reason } from '../model/project';
import type { Plan, Project, ProductInfo } from '../model/types';
import { refreshBalance } from './balance';
import { exists, readStudioFrom, writeLibraryTo, writeStudioTo } from './scope';

/**
 * Seguimiento del vídeo en curso (prototipo: pim/video.js, startPolling y
 * applyProject): GET /video/projects/{id} cada 5 s; sigue al volver a la pestaña y
 * aunque se salga de ella. Un 404/410 o un 4xx repetido lo da por perdido; un corte
 * de red no (el vídeo se sigue generando y se vuelve a preguntar, cada vez más tarde).
 */

interface Run {
  scope: PimScope;
  timer: ReturnType<typeof setTimeout> | null;
  failures: number;
}

const runs = new Map<string, Run>();

/**
 * El resultado entra en la biblioteca (sin cambiar el vídeo elegido: «Ver en Vídeos
 * del producto» lo elige). Devuelve si la biblioteca cambió.
 */
export function addToLibrary(scope: PimScope, project: Project, plan: Plan | null | undefined, product: ProductInfo | null): boolean {
  const video = libraryVideoFromProject(project, plan, product);
  if (!video) return false;
  let added = false;
  writeLibraryTo(scope, library => {
    if (library.videos.some(item => item.id === video.id)) return library;
    added = true;
    return { videos: [...library.videos, video], selectedId: library.selectedId || video.id };
  });
  return added;
}

/** Aplica el estado que devuelve el servidor al vídeo en curso de ese producto. */
export function applyProject(scope: PimScope, id: string, data: unknown): Project | null {
  const state = readStudioFrom(scope);
  if (!state.project || state.project.id !== id) return null;
  const next = projectFrom(data, state.project);
  if (!next) return null;
  let announce = false;
  const previous = state.project;
  if (next.status === 'done' && next.result && !(previous.status === 'done' && previous.result?.version === next.result.version)) {
    addToLibrary(scope, next, state.plans[next.destination], scope.get<ProductInfo | null>('productInfo', null));
    announce = true;
    next.announced = true;
  }
  writeStudioTo(scope, current => ({ ...current, project: next }));
  if (announce) toast.success('Tu vídeo está listo', { description: 'Lo tienes en «Vídeos del producto».' });
  if (announce || next.status === 'failed') void refreshBalance(true);
  return next;
}

const LOST = 'Ya no podemos consultar este vídeo. El saldo de lo que no se generó no se descuenta.';

export function startPolling(scope: PimScope, id: string): void {
  const running = runs.get(id);
  if (running) {
    running.scope = scope;
    return;
  }
  const run: Run = { scope, timer: null, failures: 0 };
  runs.set(id, run);
  const tick = async () => {
    const project = readStudioFrom(run.scope).project;
    if (!exists(run.scope) || !project || project.id !== id) {
      runs.delete(id);
      return;
    }
    try {
      const data = await getProject(id);
      if (!exists(run.scope)) {
        runs.delete(id);
        return;
      }
      run.failures = 0;
      applyProject(run.scope, id, data);
    } catch (error) {
      if (!exists(run.scope)) {
        runs.delete(id);
        return;
      }
      run.failures += 1;
      const status = httpStatus(error);
      const lost = status === 404 || status === 410
        || (status !== undefined && status >= 400 && status < 500 && ![408, 429].includes(status) && run.failures >= 3);
      writeStudioTo(run.scope, state => (state.project?.id !== id ? state : {
        ...state,
        project: lost
          ? { ...state.project, status: 'failed', error: LOST, pollError: '' }
          : { ...state.project, pollError: reason(error) },
      }));
    }
    const now = readStudioFrom(run.scope).project;
    if (!runs.has(id) || !now || now.id !== id || !ACTIVE.has(now.status)) {
      runs.delete(id);
      return;
    }
    run.timer = setTimeout(() => void tick(), Math.min(60000, POLL_MS * 2 ** Math.min(run.failures, 4)));
  };
  run.timer = setTimeout(() => void tick(), POLL_MS);
}

export const isPolling = (id: string): boolean => runs.has(id);

/** Para todos los seguimientos (pruebas, cierre de sesión). */
export function stopAllPolling(): void {
  runs.forEach(run => {
    if (run.timer) clearTimeout(run.timer);
  });
  runs.clear();
}
