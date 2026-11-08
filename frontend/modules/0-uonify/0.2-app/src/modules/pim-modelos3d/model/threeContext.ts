/**
 * ThreeJSContext del original (E53): máximo 3 canvas WebGL a la vez,
 * inicializado a los 150 ms; los registros sin renovar en 15 s se descartan.
 * El visor renueva el suyo cada 5 s. Avisa a quien se suscribe (superposición
 * «Visor 3D en Pausa», insignia «Modo Optimizado» de la Vista AR).
 */
export interface ThreeContext {
  readonly maxCanvases: number;
  readonly staleMs: number;
  isInitialized(): boolean;
  register(id: string): boolean;
  touch(id: string): void;
  unregister(id: string): void;
  canRender(): boolean;
  count(): number;
  subscribe(listener: () => void): () => void;
  /** Versión que cambia con cada aviso (para useSyncExternalStore). */
  version(): number;
}

export interface ThreeContextOptions {
  maxCanvases?: number;
  staleMs?: number;
  initDelay?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
}

export function createThreeContext({
  maxCanvases = 3,
  staleMs = 15_000,
  initDelay = 150,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
}: ThreeContextOptions = {}): ThreeContext {
  const active = new Map<string, number>();
  let queue: string[] = [];
  let initialized = false;
  let revision = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    revision += 1;
    listeners.forEach(listener => listener());
  };
  const prune = () => {
    const time = now();
    active.forEach((seen, id) => { if (time - seen > staleMs) active.delete(id); });
  };
  schedule(() => { initialized = true; emit(); }, initDelay);

  return {
    maxCanvases,
    staleMs,
    isInitialized: () => initialized,
    register(id) {
      prune();
      if (active.has(id) || active.size < maxCanvases) {
        active.set(id, now());
        queue = queue.filter(item => item !== id);
        emit();
        return true;
      }
      if (!queue.includes(id)) queue.push(id);
      return false;
    },
    touch(id) {
      if (active.has(id)) active.set(id, now());
    },
    unregister(id) {
      active.delete(id);
      queue = queue.filter(item => item !== id);
      while (queue.length && active.size < maxCanvases) active.set(queue.shift() as string, now());
      emit();
    },
    canRender() {
      prune();
      return initialized && active.size < maxCanvases;
    },
    count() {
      prune();
      return active.size;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => revision,
  };
}

/** El registro de la página (compartido por todos los visores del módulo). */
export const threeContext = createThreeContext();
