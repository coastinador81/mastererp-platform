import { useEffect, useState } from 'react';
import { useMediaQuery } from '@/shared/hooks';
import { SECTION_NAV } from './productosContent';

/**
 * Franja superior que no cuenta para marcar la sección visible. En escritorio (más de 900 px)
 * la cabecera y este índice van fijos y las anclas se paran a 248 px del borde
 * (styles/common/page-header.css): la franja llega a 256 px para que la sección anterior, que
 * acaba justo encima, no gane a la pulsada. En móvil la cabecera no es fija: 90 px.
 */
const DESKTOP_QUERY = '(min-width: 901px)';
const rootMargin = (desktop: boolean) => `${desktop ? -256 : -90}px 0px -55% 0px`;

/**
 * Índice de secciones de Productos: marca la sección visible (aria-current="location")
 * con un IntersectionObserver, como productos.js.
 */
export function SectionNav() {
  const [active, setActive] = useState<string | null>(null);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: rootMargin(desktop), threshold: 0 });
    SECTION_NAV.forEach(item => { const section = document.getElementById(item.id); if (section) observer.observe(section); });
    return () => observer.disconnect();
  }, [desktop]);
  return (
    <nav className="section-nav" aria-label="Explora los productos">
      {SECTION_NAV.map(item => (
        <a key={item.id} href={`#${item.id}`} className={active === item.id ? 'is-active' : undefined} aria-current={active === item.id ? 'location' : undefined}>{item.label}</a>
      ))}
    </nav>
  );
}
