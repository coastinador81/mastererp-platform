import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ToastContent { id: number; title: string; copy: string }

/** Tiempo que el PROTO dejaba visibles los avisos de demostración. */
export const DEMO_TOAST_MS = 5200;

/**
 * Aviso de las demostraciones de «Cómo funciona» (.how-toast) y «Para empresas»
 * (.demo-toast): uno a la vez, en el <body> (hereda las variables de la página),
 * con role="status" y cierre automático a los 5,2 s, como el PROTO.
 */
export function useDemoToast(className: 'how-toast' | 'demo-toast'): [ReactNode, (title: string, copy: string) => void] {
  const [toast, setToast] = useState<ToastContent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((title: string, copy: string) => {
    clearTimeout(timer.current);
    setToast(current => ({ id: (current?.id ?? 0) + 1, title, copy }));
    timer.current = setTimeout(() => setToast(null), DEMO_TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = toast
    ? createPortal(<div key={toast.id} className={className} role="status"><strong>{toast.title}</strong><span>{toast.copy}</span></div>, document.body)
    : null;
  return [node, show];
}
