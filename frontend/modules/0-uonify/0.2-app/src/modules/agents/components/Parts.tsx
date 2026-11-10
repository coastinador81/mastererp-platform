import type { ReactNode } from 'react';
import { Icon } from '@/shared/ui';
import { AGENT_ICON_PATHS, type AgentIconName } from '../model/catalog';

const RAIL_PATHS = {
  panel: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  threads: '<path d="M4 5h11v8H8l-4 3V5Z"/><path d="M15 9h5v10l-3-2.5h-7V13"/>',
} as const;

/** Iconos del raíl, los mismos trazos que el catálogo de Producto. */
export function RailIcon({ name }: { name: keyof typeof RAIL_PATHS }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: RAIL_PATHS[name] }} />;
}

export function AgentIcon({ name }: { name: AgentIconName }) {
  return <svg className="agents-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: AGENT_ICON_PATHS[name] }} />;
}

/** Inicial de un agente en el cuadro de su fila o ficha. */
export const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || 'A';

export interface DrawerHeaderProps {
  eyebrow: string;
  title: string;
  navOpen: boolean;
  onBack?: () => void;
}

/** Cabecera del panel lateral, la del catálogo de Producto. */
export function DrawerHeader({ eyebrow, title, navOpen, onBack }: DrawerHeaderProps) {
  return (
    <header>
      {onBack ? (
        <button type="button" className="product-icon-button agents-drawer-back" aria-label="Volver al menú de Agentes" data-tooltip="Menú de Agentes" data-tooltip-pos="below" onClick={onBack}>
          <Icon name="chevron-left" />
        </button>
      ) : null}
      <div className="agents-drawer-title">
        <span className="product-drawer-eyebrow">{eyebrow}</span>
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

export interface SheetHeaderProps {
  mark: ReactNode;
  title: string;
  subtitle: string;
  status?: string;
  closeLabel: string;
  onClose: (detail: number) => void;
  actions?: ReactNode;
}

/** Cabecera de las fichas (la de Producto): cuadro, título, subtítulo, estado y cerrar. */
export function SheetHeader({ mark, title, subtitle, status, closeLabel, onClose, actions }: SheetHeaderProps) {
  return (
    <header className="product-center-header">
      <div className="product-source-header-summary">
        <div className="product-heading-mark agents-heading-mark">{mark}</div>
        <div className="product-center-title">
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {status ? <span className="product-source-status agents-status">{status}</span> : null}
        </div>
        <div className="product-header-side">
          {actions}
          <div className="product-header-icons">
            <button
              type="button"
              className="product-icon-button product-sheet-close"
              aria-label={closeLabel}
              data-tooltip={closeLabel}
              data-tooltip-pos="below"
              data-tooltip-align="end"
              onClick={event => onClose(event.detail)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 6 12 12M6 18 18 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

/** Sección plana del kit (pim-section). */
export function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="pim-section agents-section">
      <div className="pim-section-head">
        <div>
          <h2 className="pim-section-title">{title}</h2>
          {sub ? <p className="pim-section-sub">{sub}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}
