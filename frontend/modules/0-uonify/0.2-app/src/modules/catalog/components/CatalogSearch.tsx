import { useId, useState } from 'react';
import { LinkButton, Select } from '@/shared/ui';
import { EMPTY_FILTERS, hasActiveFilters, type SourceFilter, type StatusFilter } from '../model/catalogRules';
import { useCatalogStore } from '../hooks/useCatalogStore';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'published', label: 'Publicados' },
  { value: 'draft', label: 'Borradores' },
  { value: 'processing', label: 'Procesando' },
];

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'uonify', label: 'Uonify' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'shopify', label: 'Shopify' },
];

/**
 * Búsqueda por nombre o SKU y filtros de estado y fuente del catálogo (prototipo:
 * .product-search y .product-filter-trigger; comportamiento de la ficha original,
 * ProductsPIMInterface.tsx).
 */
export function CatalogSearch() {
  const filters = useCatalogStore(state => state.filters);
  const setFilters = useCatalogStore(state => state.setFilters);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const statusId = useId();
  const sourceId = useId();
  const active = hasActiveFilters(filters);
  return (
    <>
      <label className="product-search">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Buscar por nombre o SKU"
          aria-label="Buscar productos"
          value={filters.search}
          onChange={event => setFilters({ search: event.target.value })}
        />
      </label>
      <button
        type="button"
        className="product-filter-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
      >
        Filtros <span>{active ? 'Activos' : 'Todos'}</span>
      </button>
      <div className="product-filter-panel" id={panelId} role="group" aria-label="Filtros del catálogo" hidden={!open}>
        <label className="product-filter-field" htmlFor={statusId}>
          <span>Estado</span>
          <Select id={statusId} value={filters.status} options={STATUS_OPTIONS} onChange={event => setFilters({ status: event.target.value as StatusFilter })} />
        </label>
        <label className="product-filter-field" htmlFor={sourceId}>
          <span>Fuente</span>
          <Select id={sourceId} value={filters.source} options={SOURCE_OPTIONS} onChange={event => setFilters({ source: event.target.value as SourceFilter })} />
        </label>
        <LinkButton className="product-filter-clear" disabled={!active} onClick={() => setFilters({ status: EMPTY_FILTERS.status, source: EMPTY_FILTERS.source })}>
          Limpiar filtros
        </LinkButton>
      </div>
    </>
  );
}
