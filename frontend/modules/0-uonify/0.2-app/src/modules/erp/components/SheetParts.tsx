import { Fragment, type ReactNode } from 'react';

/** Referencias técnicas en monoespaciada (manual, p. 16). */
export const mono = (value: ReactNode) => <span className="pim-mono">{value}</span>;

export interface SheetHeaderProps {
  icon: ReactNode;
  title: string;
  /** La referencia del documento va en monoespaciada. */
  monoTitle?: boolean;
  subtitle: string;
  status: string;
  closeLabel: string;
  onClose: (detail: number) => void;
}

/**
 * Cabecera de las fichas de Finanzas, la de Producto (ProductHeader): cuadro con el icono,
 * título, subtítulo, estado y el botón de cerrar arriba a la derecha.
 */
export function SheetHeader({ icon, title, monoTitle = false, subtitle, status, closeLabel, onClose }: SheetHeaderProps) {
  return (
    <header className="product-center-header">
      <div className="product-source-header-summary">
        <div className="product-heading-mark erp-heading-icon">{icon}</div>
        <div className="product-center-title">
          <h1 className={monoTitle ? 'pim-mono' : undefined}>{title}</h1>
          <p>{subtitle}</p>
          <span className="product-source-status">{status}</span>
        </div>
        <div className="product-header-side">
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
              {/* El mismo icono que el catálogo (ProductIcon «close»). */}
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

/** Sección plana del kit (pim-section) con su título y una nota opcional al pie. */
export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="pim-section erp-section">
      <div className="pim-section-head">
        <h2 className="pim-section-title">{title}</h2>
      </div>
      {children}
      {note ? <p className="pim-section-sub erp-note">{note}</p> : null}
    </section>
  );
}

export type Row = [string, ReactNode];

/** Pares campo-valor del kit (pim-kv). */
export function Fields({ items }: { items: Row[] }) {
  return (
    <dl className="pim-kv erp-kv">
      {items.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
