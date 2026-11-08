import { useEffect, useState } from 'react';
import { SECTION_NAV } from './productosContent';

/**
 * Índice de secciones de Productos: marca la sección visible (aria-current="location")
 * con un IntersectionObserver, como productos.js.
 */
export function SectionNav() {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: '-90px 0px -55% 0px', threshold: 0 });
    SECTION_NAV.forEach(item => { const section = document.getElementById(item.id); if (section) observer.observe(section); });
    return () => observer.disconnect();
  }, []);
  return (
    <nav className="section-nav" aria-label="Explora los productos">
      {SECTION_NAV.map(item => (
        <a key={item.id} href={`#${item.id}`} className={active === item.id ? 'is-active' : undefined} aria-current={active === item.id ? 'location' : undefined}>{item.label}</a>
      ))}
    </nav>
  );
}
