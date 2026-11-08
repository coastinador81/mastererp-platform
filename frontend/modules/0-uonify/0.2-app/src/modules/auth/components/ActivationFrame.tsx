import type { ReactNode } from 'react';
import { BRAND } from './brand';

interface Props { header: ReactNode; children: ReactNode }

/** Recupera el marco aprobado sin cambiar las operaciones de la preparación. */
export function ActivationFrame({ header, children }: Props) {
  return <div className="uon-onboard-shell">
    <aside className="uon-onboard-side">
      <img className="uon-profile-brand" src={BRAND.wordmark} width={142} height={30} alt="Uonify" />
      <div className="uon-onboard-side-copy">
        <span>Hazlo <em>posible.</em></span>
        <img className="activation-character" src="/assets/productos/catalogo.png" width="1200" height="1200" alt="El personaje de Producto de Uonify" />
        <p>Una ficha. Muchas posibilidades.</p>
      </div>
    </aside>
    <div className="uon-onboard-main">
      <div className="activation-stage-header">{header}</div>
      <div className="activation-stage-body">{children}</div>
    </div>
  </div>;
}
