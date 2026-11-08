/**
 * Utilidades de tiempo (prototipo: pim/core.js, util.sleep y util.debounce).
 */

/** Espera `ms` milisegundos. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  /** Anula la llamada pendiente. */
  cancel(): void;
  /** Ejecuta ya la llamada pendiente, si la hay. */
  flush(): void;
}

/**
 * Retrasa `fn` hasta que pasan `ms` sin nuevas llamadas (se ejecuta con los
 * últimos argumentos). Añade cancel() y flush() para limpiar al desmontar.
 */
export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms = 250): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Args | null = null;
  const run = () => {
    timer = null;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  };
  const debounced = ((...args: Args) => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as Debounced<Args>;
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  debounced.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    run();
  };
  return debounced;
}
