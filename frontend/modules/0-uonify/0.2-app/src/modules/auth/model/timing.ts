/**
 * Tiempos de la transición (prototipo: transitionTiming). El tiempo de lectura
 * no depende de la preferencia de movimiento ni de la red.
 */
export interface TransitionTiming {
  /** Cada mensaje se lee al menos este tiempo. */
  message: number;
  /** «Todo listo» antes de abrir el espacio. */
  ready: number;
  /** Límite para preparar y abrir el espacio. */
  workspaceTimeout: number;
  /** Aviso «Lleva más tiempo de lo esperado». */
  watchdog: number;
  /** Salida de la capa (y con movimiento reducido). */
  leave: number;
  leaveReduced: number;
  /** Duración de la animación de aparición del espacio. */
  reveal: number;
}

const DEFAULT_TIMING: TransitionTiming = {
  message: 1200,
  ready: 1000,
  workspaceTimeout: 24000,
  watchdog: 30000,
  leave: 220,
  leaveReduced: 80,
  reveal: 240,
};

export const timing: TransitionTiming = { ...DEFAULT_TIMING };

/** Solo para pruebas: acorta los tiempos (o los restaura sin argumentos). */
export function configureTiming(partial?: Partial<TransitionTiming>): void {
  Object.assign(timing, DEFAULT_TIMING, partial ?? {});
}

export const delay = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

/** Movimiento reducido: preferencia del sistema o de la cuenta (data-reduce-motion). */
export function prefersReducedMotion(): boolean {
  const system = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return system || document.documentElement.dataset.reduceMotion === 'true';
}

export function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve());
    else window.setTimeout(resolve, 16);
  });
}
