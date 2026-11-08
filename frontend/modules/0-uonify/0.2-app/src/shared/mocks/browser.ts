import { setupWorker } from 'msw/browser';
import { handlers } from '@/shared/mocks/handlers';
import { API_BASE } from '@/shared/api/config';

// Los handlers dependen de modelos y componentes que Vite actualiza en caliente.
// Crear otro worker en cada actualización deja la nueva instancia sin arrancar
// y la anterior interceptando con dependencias obsoletas. Conservar la instancia.
type Worker = ReturnType<typeof setupWorker>;
const previous = import.meta.hot?.data.worker as Worker | undefined;
export const worker: Worker = previous ?? setupWorker(...handlers);
if (previous) worker.resetHandlers(...handlers);
if (import.meta.hot) {
  import.meta.hot.data.worker = worker;
  import.meta.hot.accept();
}

/** Arranca la simulación del backend. Avisa en consola de rutas de la API sin simular. */
export async function startMockWorker(): Promise<void> {
  await worker.start({
    quiet: true,
    onUnhandledRequest(request, print) {
      if (new URL(request.url).pathname.startsWith(API_BASE)) print.warning();
    },
  });
}

let recovery: Promise<void> | null = null;

/** Recupera la interceptación si una pestaña abierta pierde el worker de desarrollo. */
export function restartMockWorker(): Promise<void> {
  if (!recovery) {
    worker.stop();
    recovery = startMockWorker().finally(() => { recovery = null; });
  }
  return recovery;
}
