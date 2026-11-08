import { useBalanceStore, noBalanceIn, type BalanceState } from '../jobs/balance';
import { busyIn, detectionIn, generatingTag, useJobsStore, type Detection } from '../jobs/jobsStore';

/** Estado del trabajo en segundo plano de un producto, para pintarlo. */

export function useBusy(key: string, test: (tag: string) => boolean): boolean {
  return useJobsStore(state => busyIn(state.tasks, key, test));
}

/** Generando o rehaciendo algún plano de ese producto. */
export function useGenerating(key: string): boolean {
  return useJobsStore(state => busyIn(state.tasks, key, generatingTag));
}

/** Planos que se están rehaciendo en ese producto. */
export function useRetryingShots(key: string): (shotId: string) => boolean {
  // Una cadena (valor primitivo) para que el selector no cree listas nuevas en cada lectura.
  const joined = useJobsStore(state => state.tasks
    .filter(task => task.scope.key === key && task.tag.startsWith('retry:'))
    .map(task => task.tag.slice('retry:'.length))
    .join('\n'));
  return (shotId: string) => joined.split('\n').includes(shotId);
}

export function useDetection(key: string): Detection | null {
  return useJobsStore(state => detectionIn(state.detections, key));
}

export function useBalance(): BalanceState & { empty: boolean } {
  const balance = useBalanceStore();
  return { ...balance, empty: noBalanceIn(balance) };
}
