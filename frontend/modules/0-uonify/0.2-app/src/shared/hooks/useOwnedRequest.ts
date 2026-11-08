import { useEffect, useRef } from 'react';

/** Vincula cada operación a la identidad y a la instancia que la inició. */
export function useOwnedRequest(owner: string, readOwner: () => string | null) {
  const mounted = useRef(true);
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const lastOwner = useRef(owner);
  useEffect(() => {
    const cancel = () => { generation.current += 1; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); };
    if (lastOwner.current !== owner) cancel();
    lastOwner.current = owner;
    mounted.current = true;
    window.addEventListener('uonify:identity-changed', cancel);
    return () => {
      mounted.current = false;
      // StrictMode repite los efectos de la misma instancia. Un desmontaje real
      // invalida inmediatamente los resultados y aborta al terminar este turno.
      queueMicrotask(() => { if (!mounted.current) cancel(); });
      window.removeEventListener('uonify:identity-changed', cancel);
    };
  }, [owner, readOwner]);
  const current = () => mounted.current && !!owner && readOwner() === owner;
  const begin = (signal?: AbortSignal, timeout = 60_000) => {
    if (!current()) return null;
    const controller = new AbortController();
    const version = generation.current;
    controllers.current.add(controller);
    const valid = () => current() && generation.current === version && !controller.signal.aborted;
    return {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
      valid,
      check: () => { if (!valid()) throw new DOMException('La sesión ha cambiado.', 'AbortError'); },
      finish: () => controllers.current.delete(controller),
    };
  };
  const read = async <T,>(request: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const task = begin(signal);
    if (!task) throw new DOMException('La sesión ha cambiado.', 'AbortError');
    try { const result = await request(task.signal); task.check(); return result; }
    finally { task.finish(); }
  };
  return { current, begin, read };
}
