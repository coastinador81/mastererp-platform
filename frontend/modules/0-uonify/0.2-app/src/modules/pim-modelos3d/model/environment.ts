/**
 * Capacidades del navegador que consulta la pestaña «3D».
 */

/**
 * Movimiento reducido: la preferencia del sistema o la de la cuenta
 * (`:root[data-reduce-motion="true"]`). La escena la lee en cada fotograma.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  const system = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return system || document.documentElement.dataset.reduceMotion === 'true';
}

/** Si el navegador puede crear un contexto WebGL (se libera en el acto). */
export function checkWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}
