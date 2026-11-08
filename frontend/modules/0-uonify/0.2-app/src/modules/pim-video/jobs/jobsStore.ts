import { create } from 'zustand';
import type { PimScope } from '@/shared/pim';
import { uid } from '@/shared/lib';

/**
 * Trabajo en segundo plano de la pestaña «Vídeo» (prototipo: pim/video.js,
 * `detections` y `tasks`). Detecciones de escenas, propuestas de guion, envíos y
 * rehacer planos siguen aunque se cambie de pestaña. Cada uno guarda el ámbito del
 * almacén de su producto, que sigue al producto si «Guardar y Crear» o un cambio de
 * SKU le dan otra clave; la pestaña montada pinta su estado.
 *
 * Etiquetas de tarea: 'propose', 'generate', 'retry:<plano>', 'ads:<vídeo>'.
 */

export interface Detection {
  id: string;
  scope: PimScope;
  videoId: string;
  progress: number;
  /** Compartido con el bucle de detección: al eliminar el vídeo se para. */
  control: { cancelled: boolean };
}

export interface Task {
  id: string;
  scope: PimScope;
  tag: string;
}

interface JobsState {
  detections: Detection[];
  tasks: Task[];
}

export const useJobsStore = create<JobsState>(() => ({ detections: [], tasks: [] }));

/** Empieza una tarea; devuelve la función que la da por terminada. */
export function startTask(scope: PimScope, tag: string): () => void {
  const task: Task = { id: uid('video-task'), scope, tag };
  useJobsStore.setState(state => ({ tasks: [...state.tasks, task] }));
  return () => useJobsStore.setState(state => ({ tasks: state.tasks.filter(item => item.id !== task.id) }));
}

export const busyIn = (tasks: Task[], key: string, test: (tag: string) => boolean): boolean =>
  tasks.some(task => task.scope.key === key && test(task.tag));

export const isBusy = (key: string, test: (tag: string) => boolean): boolean => busyIn(useJobsStore.getState().tasks, key, test);

/** Generando o rehaciendo algún plano. */
export const generatingTag = (tag: string): boolean => tag === 'generate' || tag.startsWith('retry:');

export const detectionIn = (detections: Detection[], key: string): Detection | null =>
  detections.find(job => job.scope.key === key) || null;

export const detectionFor = (key: string): Detection | null => detectionIn(useJobsStore.getState().detections, key);

export function startDetection(scope: PimScope, videoId: string): Detection {
  const job: Detection = { id: uid('video-scenes'), scope, videoId, progress: 0, control: { cancelled: false } };
  useJobsStore.setState(state => ({ detections: [...state.detections, job] }));
  return job;
}

export function setDetectionProgress(id: string, progress: number): void {
  useJobsStore.setState(state => ({ detections: state.detections.map(job => (job.id === id ? { ...job, progress } : job)) }));
}

export function endDetection(id: string): void {
  useJobsStore.setState(state => ({ detections: state.detections.filter(job => job.id !== id) }));
}

/** Para la detección de ese vídeo (se ha eliminado). */
export function cancelDetection(key: string, videoId: string): void {
  const job = detectionFor(key);
  if (job?.videoId === videoId) job.control.cancelled = true;
}

/** Vacía el registro (pruebas). */
export function resetJobs(): void {
  useJobsStore.setState({ detections: [], tasks: [] });
}
