import { Icon } from '@/shared/ui';
import { RailIcon } from './RailIcon';

export interface DrawerHeaderProps {
  eyebrow: string;
  /** El recuento se anuncia al cambiar (role="status"), como el de la demo. */
  liveEyebrow?: boolean;
  title: string;
  navOpen: boolean;
  /** Vuelve al menú de Finanzas (solo dentro de un apartado). */
  onBack?: () => void;
}

/** Cabecera del panel lateral, la misma del catálogo de Producto (CatalogSidebar). */
export function DrawerHeader({ eyebrow, liveEyebrow = false, title, navOpen, onBack }: DrawerHeaderProps) {
  return (
    <header>
      {onBack ? (
        <button
          type="button"
          className="product-icon-button erp-drawer-back"
          aria-label="Volver al menú de Finanzas"
          data-tooltip="Menú de Finanzas"
          data-tooltip-pos="below"
          onClick={onBack}
        >
          <Icon name="chevron-left" />
        </button>
      ) : null}
      <div className="erp-drawer-title">
        <span className="product-drawer-eyebrow" role={liveEyebrow ? 'status' : undefined}>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <button
        type="button"
        className="product-icon-button product-drawer-threads"
        data-open-nav
        aria-controls="nav-drawer"
        aria-expanded={navOpen}
        aria-label="Hilos y proyectos"
        data-tooltip="Hilos y proyectos"
        data-tooltip-pos="below"
      >
        <RailIcon name="threads" />
      </button>
    </header>
  );
}
