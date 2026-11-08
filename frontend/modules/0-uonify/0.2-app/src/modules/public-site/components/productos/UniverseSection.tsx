import { useState } from 'react';
import { useMediaQuery } from '@/shared/hooks';
import { FAMILY } from './productosContent';

/**
 * «Tus productos. Un universo de posibilidades.»: carrusel infinito de los nueve
 * servicios (la segunda vuelta es decorativa) con botón de pausa (productos.js).
 * Con movimiento reducido del sistema queda quieto y el botón se oculta.
 */
export function UniverseSection() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [paused, setPaused] = useState(reduced);
  const stopped = paused || reduced;
  return (
    <section className="universe" aria-labelledby="universe-title">
      <div className="marquee-shell">
        <div className="marquee" role="region" aria-label="Los nueve servicios de Uonify">
          <div className={`marquee-track is-ready${stopped ? ' is-paused' : ''}`} id="family-track">
            {FAMILY.map(item => (
              <a key={item.id} href={`#${item.id}`} aria-label={item.label}><img src={`/assets/product-icons/${item.icon}.png`} width="64" height="64" alt="" /></a>
            ))}
            {FAMILY.map(item => (
              <a key={`copy-${item.id}`} href={`#${item.id}`} aria-hidden="true" tabIndex={-1}><img src={`/assets/product-icons/${item.icon}.png`} width="64" height="64" alt="" /></a>
            ))}
          </div>
        </div>
        <button
          className="pause-button"
          id="marquee-pause"
          type="button"
          aria-label={paused ? 'Reanudar movimiento de los productos' : 'Pausar movimiento de los productos'}
          aria-pressed={stopped}
          hidden={reduced}
          onClick={() => setPaused(value => !value)}
        >
          <span aria-hidden="true">{paused ? '▷' : 'Ⅱ'}</span>
        </button>
      </div>
      <div className="universe-copy wrap">
        <h1 id="universe-title">Tus productos.{' '}<br /><span>Un universo de posibilidades.</span></h1>
        <p>Empieza por tus productos. Conecta el resto de tu negocio.</p>
      </div>
    </section>
  );
}
