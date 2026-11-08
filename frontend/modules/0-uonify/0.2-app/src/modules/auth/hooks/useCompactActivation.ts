import { useEffect, useState } from 'react';

const QUERY = '(max-width: 760px), (max-height: 720px)';

/** Pantallas pequeñas y zoom reciben apartados completos, sin reducir el texto. */
export function useCompactActivation() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}
