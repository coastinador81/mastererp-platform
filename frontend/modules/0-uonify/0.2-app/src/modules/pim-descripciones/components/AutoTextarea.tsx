import { useLayoutEffect, useRef, type ComponentProps } from 'react';

// field-sizing: content (ui/textarea.tsx del original), con alternativa si el navegador no lo tiene.
const supportsFieldSizing = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

/** Textarea que crece con su contenido. */
export function AutoTextarea(props: ComponentProps<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { value } = props;
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (supportsFieldSizing || !textarea || !textarea.isConnected) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} {...props} />;
}
