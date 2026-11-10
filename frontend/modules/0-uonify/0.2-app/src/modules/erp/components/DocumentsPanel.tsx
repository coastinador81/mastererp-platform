import clsx from 'clsx';
import { useMemo } from 'react';
import { Icon } from '@/shared/ui';
import { useFinanceFilters, useListFilters } from '../hooks/useFinanceFilters';
import { useListRows } from '../hooks/useSuggestions';
import { NODES, currencyLabel, dateLabel, filterPurchases, money, statusTone, suggestPurchases, type PurchaseFilters } from '../model/demoPurchases';
import type { DocumentsList } from '../model/lists';
import { DrawerHeader } from './DrawerHeader';
import { PurchaseFiltersPanel } from './PurchaseFiltersPanel';

export interface DocumentsPanelProps {
  list: DocumentsList;
  selected: string | null;
  navOpen: boolean;
  onBack: () => void;
  onOpen: (reference: string) => void;
}

/** Línea de ámbito de Órdenes, literal de la demo (PurchasesListPreview.jsx:95). */
function scopeOf(filters: PurchaseFilters): string {
  const node = NODES.find(item => item.id === filters.node)?.name ?? 'Todos los nodos';
  const search = filters.search ? ` · Búsqueda: ${filters.search}` : '';
  return `${node} · ${filters.from || 'Sin fecha inicial'} — ${filters.to || 'Sin fecha final'} · ${currencyLabel(filters.currency)}${search}`;
}

/**
 * Lista de un apartado de Finanzas dentro del panel lateral: búsqueda, filtros y filas,
 * con las clases del catálogo de Producto (CatalogSearch y CatalogList) y los datos y
 * textos de la demo del equipo. El importe va primero para que nunca se corte.
 */
export function DocumentsPanel({ list, selected, navOpen, onBack, onOpen }: DocumentsPanelProps) {
  const { draft, applied } = useListFilters(list.route);
  const setFilters = useFinanceFilters(state => state.setFilters);
  const rows = useListRows(list);
  const visible = useMemo(() => filterPurchases(rows, applied), [rows, applied]);
  const suggestions = useMemo(() => (list.suggests ? suggestPurchases(rows, draft) : []), [list.suggests, rows, draft]);
  const orders = list.kind === 'orders';
  return (
    <>
      <DrawerHeader eyebrow={list.countLabel(visible.length)} liveEyebrow title={list.title} navOpen={navOpen} onBack={onBack} />
      <p className="erp-drawer-description">{list.description}</p>
      <PurchaseFiltersPanel
        searchLabel={list.searchLabel}
        draft={draft}
        statuses={list.statuses}
        suggests={list.suggests}
        suggestions={suggestions}
        dateLabels={list.dateLabels}
        currencyBeforeStatus={list.currencyBeforeStatus}
        onChange={next => setFilters(list.route, next)}
      />
      {orders ? <p className="erp-drawer-scope" role="status">{scopeOf(applied)}</p> : null}
      <div className="product-catalog-list">
        {visible.length ? visible.map(item => {
          const amount = `${currencyLabel(item.currency)} ${money(item.total)}`;
          const where = orders ? `${dateLabel(item.date)} · ${item.node} · ${item.status}` : `${dateLabel(item.date)} · ${item.node}`;
          return (
            <div key={item.reference} className="product-catalog-row">
              <button
                type="button"
                className={clsx('product-catalog-item', item.reference === selected && 'is-selected')}
                aria-current={item.reference === selected ? 'true' : undefined}
                title={`${item.reference} · ${item.supplier} · ${amount}`}
                onClick={() => onOpen(item.reference)}
              >
                <span className="product-item-thumb erp-item-thumb" aria-hidden="true"><Icon name="file" size={18} strokeWidth={1.7} /></span>
                <span>
                  <strong className="pim-mono">{item.reference}</strong>
                  <small>{amount} · {item.supplier}</small>
                  <small>{item.concept}</small>
                  <small>{where}</small>
                  {orders && item.source ? <small>Compra de origen {item.source} · Sin programar</small> : null}
                </span>
                {orders ? (
                  <span className="product-item-state erp-item-state" data-tone={statusTone(item.status)} aria-hidden="true" />
                ) : (
                  <span className="product-item-state erp-item-state" data-tone={statusTone(item.status)} role="img" aria-label={item.status} title={item.status} />
                )}
              </button>
            </div>
          );
        }) : (
          <div className="product-catalog-empty">
            <strong>No hay documentos DEMO que coincidan con los filtros.</strong>
          </div>
        )}
        {list.footnote ? <p className="pim-section-sub erp-note erp-drawer-footnote">{list.footnote}</p> : null}
      </div>
    </>
  );
}
