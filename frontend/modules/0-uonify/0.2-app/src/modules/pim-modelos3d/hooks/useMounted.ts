import { useEffect, useRef, type RefObject } from 'react';

/**
 * Si el componente sigue montado (para trabajos que acaban tarde). Vale también
 * con el doble efecto de StrictMode: vuelve a true al montarse otra vez.
 */
export function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}
