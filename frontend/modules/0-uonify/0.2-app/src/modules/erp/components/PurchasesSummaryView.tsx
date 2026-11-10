import { useId, useRef, useState, type FormEvent } from 'react';
import { Button, ErrorText, Input, Select } from '@/shared/ui';
import { CURRENCY_OPTIONS, DATE_RANGE_ERROR, NODES, currencyLabel, invalidRange, type Currency } from '../model/demoPurchases';
import { FINANCE_ICON_PATHS } from '../model/menu';
import { INDICATORS, SUMMARY_ICON_PATHS, SUMMARY_TABLES, datesLabel, type SummaryIcon } from '../model/summary';
import { SheetHeader } from './SheetParts';

function SummaryIconSvg({ name }: { name: SummaryIcon }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: SUMMARY_ICON_PATHS[name] }} />;
}

interface SummaryFilters {
  node: string;
  from: string;
  to: string;
  currency: Currency;
}

const INITIAL: SummaryFilters = { node: '', from: '', to: '', currency: 'VES' };

/**
 * Resumen de Gestión de compras en el centro de la mesa, como una ficha de Producto, con
 * el contenido literal del equipo (PurchasesSummary.jsx): filtros que se aplican con
 * «Aplicar filtros», ámbito, seis indicadores sin cifras y dos tablas vacías.
 */
export function PurchasesSummaryView({ onClose }: { onClose: (detail: number) => void }) {
  const uid = useId();
  const id = (part: string) => `${uid}-${part}`;
  const [draft, setDraft] = useState<SummaryFilters>(INITIAL);
  const [filters, setFilters] = useState<SummaryFilters>(INITIAL);
  const [error, setError] = useState(false);
  const until = useRef<HTMLInputElement>(null);
  const node = NODES.find(item => item.id === filters.node);
  const currencyName = CURRENCY_OPTIONS.find(option => option.value === filters.currency)?.label ?? 'Bolívares (Bs.)';
  const change = (patch: Partial<SummaryFilters>) => {
    setDraft(current => ({ ...current, ...patch }));
    setError(false);
  };
  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (invalidRange(draft)) {
      setError(true);
      until.current?.focus();
      return;
    }
    setFilters(draft);
    setError(false);
  };
  const reset = () => {
    setDraft(INITIAL);
    setFilters(INITIAL);
    setError(false);
  };
  return (
    <div className="product-editor-layout erp-sheet erp-summary">
      <SheetHeader
        icon={<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: FINANCE_ICON_PATHS.summary }} />}
        title="Resumen"
        subtitle="Una visión de tus fondos y compromisos con proveedores."
        status="Vista previa · Sin datos"
        closeLabel="Cerrar resumen"
        onClose={onClose}
      />
      <div className="product-editor-surface pim-tab">
        <form className="pim-card erp-summary-filters" onSubmit={apply} noValidate aria-label="Filtros del resumen de compras">
          <div className="erp-summary-fields">
            <label className="product-filter-field" htmlFor={id('node')}>
              <span>Nodo</span>
              <Select id={id('node')} value={draft.node} onChange={event => change({ node: event.target.value })}>
                <option value="">Todos los nodos</option>
                {NODES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </label>
            <label className="product-filter-field" htmlFor={id('from')}>
              <span>Fecha desde</span>
              <Input id={id('from')} type="date" value={draft.from} onChange={event => change({ from: event.target.value })} />
            </label>
            <label className="product-filter-field" htmlFor={id('to')}>
              <span>Fecha hasta</span>
              <Input
                ref={until}
                id={id('to')}
                type="date"
                value={draft.to}
                min={draft.from || undefined}
                invalid={error}
                aria-describedby={error ? id('error') : undefined}
                onChange={event => change({ to: event.target.value })}
              />
            </label>
            <label className="product-filter-field" htmlFor={id('currency')}>
              <span>Moneda</span>
              <Select id={id('currency')} value={draft.currency} options={[...CURRENCY_OPTIONS]} onChange={event => change({ currency: event.target.value as Currency })} />
            </label>
          </div>
          <div className="erp-summary-footer">
            <p className="pim-section-sub erp-note">Importes en la moneda seleccionada. Sin conversiones.</p>
            <div className="pim-section-actions">
              <Button type="button" variant="outline" size="sm" onClick={reset}>Restablecer</Button>
              <Button type="submit" variant="primary" size="sm">Aplicar filtros</Button>
            </div>
          </div>
          {error ? <ErrorText id={id('error')}>{DATE_RANGE_ERROR}</ErrorText> : null}
        </form>
        <div className="erp-summary-scope" role="status">
          <span>{node ? 'Resumen por nodo' : 'Resumen general'} <strong>{node ? node.name : 'Todos los nodos'}</strong></span>
          <p>{datesLabel(filters.from, filters.to)}<span aria-hidden="true"> · </span>{currencyName}</p>
        </div>
        <dl className="erp-indicators" aria-label="Indicadores de compras">
          {INDICATORS.map(indicator => (
            <div className="pim-card erp-indicator" key={indicator.name}>
              <div className="erp-indicator-top">
                <dt>{indicator.name}</dt>
                <span className="erp-indicator-icon"><SummaryIconSvg name={indicator.icon} /></span>
              </div>
              <dd aria-label={`${indicator.name}: sin datos, ${filters.currency}`}>
                <span>—</span>
                <small>{currencyLabel(filters.currency)}</small>
              </dd>
              <p>{indicator.description}</p>
            </div>
          ))}
        </dl>
        {SUMMARY_TABLES.map(table => (
          <section className="pim-section" key={table.id} aria-labelledby={id(table.id)}>
            <div className="pim-section-head">
              <div>
                <h2 className="pim-section-title" id={id(table.id)}>{table.title}</h2>
                <p className="pim-section-sub">{table.description}</p>
              </div>
              <span className="erp-indicator-icon"><SummaryIconSvg name={table.icon} /></span>
            </div>
            <div className="erp-table-scroll">
              <table className="erp-table erp-table-narrow">
                <thead>
                  <tr>{table.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={table.columns.length}>
                      <div className="erp-summary-empty">
                        <span className="erp-indicator-icon"><SummaryIconSvg name={table.emptyIcon} /></span>
                        <h3>{table.emptyTitle}</h3>
                        <p>{table.emptyText}</p>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="pim-section-sub erp-note">Vista de diseño con nodos de ejemplo. Los filtros solo cambian el ámbito visual; los importes y movimientos todavía no están conectados.</p>
      </div>
    </div>
  );
}
