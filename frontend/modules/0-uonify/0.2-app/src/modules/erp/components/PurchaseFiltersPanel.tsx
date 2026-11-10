import clsx from 'clsx';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ErrorText, Input, LinkButton, Select } from '@/shared/ui';
import {
  CURRENCY_OPTIONS,
  DATE_RANGE_ERROR,
  EMPTY_FILTERS,
  NODES,
  currencyLabel,
  hasActiveFilters,
  invalidRange,
  type Currency,
  type NodeId,
  type PurchaseFilters,
} from '../model/demoPurchases';

export interface PurchaseFiltersPanelProps {
  /** «Buscar compra» o «Buscar orden», como la demo. */
  searchLabel: string;
  draft: PurchaseFilters;
  statuses: readonly string[];
  /** Sugerencias del buscador (solo Compras); sin ellas, el buscador es un campo simple. */
  suggests: boolean;
  suggestions: readonly string[];
  dateLabels: { from: string; to: string };
  currencyBeforeStatus: boolean;
  onChange: (next: PurchaseFilters) => void;
}

/**
 * Búsqueda y filtros de Compras y Órdenes con el patrón del catálogo de Producto
 * (CatalogSearch: .product-search, el botón «Filtros» y su panel) y las funciones de la
 * demo del equipo (PurchasesFilters.jsx y PurchasesListPreview.jsx): sugerencias al
 * escribir en Compras (ratón, flechas, Enter y Escape), nodo, fechas, estado y moneda.
 * Un rango de fechas invertido abre el panel y avisa; si se pliega, el aviso sigue fuera.
 */
export function PurchaseFiltersPanel(props: PurchaseFiltersPanelProps) {
  const { searchLabel, draft, statuses, suggests, suggestions, dateLabels, currencyBeforeStatus, onChange } = props;
  const [open, setOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const uid = useId();
  const id = (part: string) => `${uid}-${part}`;
  const error = invalidRange(draft);
  const filtersOn = hasActiveFilters(draft);
  const set = (patch: Partial<PurchaseFilters>) => {
    const next = { ...draft, ...patch };
    if (invalidRange(next)) setOpen(true);
    onChange(next);
  };
  const showList = suggests && listOpen && draft.search.trim().length > 0 && suggestions.length > 0;
  const closeList = () => {
    setListOpen(false);
    setActive(-1);
  };
  const choose = (value: string) => {
    set({ search: value });
    closeList();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!suggests) return;
    if (event.key === 'Escape' && showList) {
      // Escape cierra primero las sugerencias; la siguiente pliega la lista, como en Producto.
      event.preventDefault();
      event.stopPropagation();
      closeList();
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length && draft.search.trim()) {
      event.preventDefault();
      setListOpen(true);
      setActive(old => (event.key === 'ArrowDown' ? (old + 1) % suggestions.length : old <= 0 ? suggestions.length - 1 : old - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (showList && active >= 0) choose(suggestions[active]);
      else closeList();
    }
  };
  const combobox = suggests
    ? {
        role: 'combobox',
        'aria-autocomplete': 'list' as const,
        'aria-expanded': showList,
        'aria-controls': id('suggestions'),
        'aria-activedescendant': showList && active >= 0 ? id(`option-${active}`) : undefined,
      }
    : {};
  const dateProps = { invalid: error, 'aria-describedby': error ? id('error') : undefined };
  const errorText = error ? <ErrorText id={id('error')}>{DATE_RANGE_ERROR}</ErrorText> : null;
  const status: ReactNode = (
    <label className="product-filter-field" htmlFor={id('status')} key="status">
      <span>Estado</span>
      <Select id={id('status')} value={draft.status} onChange={event => set({ status: event.target.value })}>
        <option value="">Todos los estados</option>
        {statuses.map(item => <option key={item} value={item}>{item}</option>)}
      </Select>
    </label>
  );
  const currency: ReactNode = (
    <label className="product-filter-field" htmlFor={id('currency')} key="currency">
      <span>Moneda</span>
      <Select id={id('currency')} value={draft.currency} options={[...CURRENCY_OPTIONS]} onChange={event => set({ currency: event.target.value as Currency })} />
    </label>
  );
  return (
    <>
      <div className="erp-search">
        <label className="product-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            autoComplete="off"
            placeholder="Referencia, proveedor o concepto"
            aria-label={searchLabel}
            {...combobox}
            value={draft.search}
            onChange={event => {
              set({ search: event.target.value });
              setListOpen(true);
              setActive(-1);
            }}
            onFocus={() => setListOpen(true)}
            onBlur={closeList}
            onKeyDown={onKeyDown}
          />
        </label>
        {suggests ? (
          <ul className="erp-search-list" id={id('suggestions')} role="listbox" aria-label="Sugerencias de compras" hidden={!showList}>
            {showList ? suggestions.map((value, index) => (
              <li
                key={value}
                id={id(`option-${index}`)}
                className={clsx('erp-search-option', index === active && 'is-active')}
                role="option"
                aria-selected={index === active}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(value)}
              >
                {value}
              </li>
            )) : null}
          </ul>
        ) : null}
      </div>
      <button type="button" className="product-filter-trigger" aria-expanded={open} aria-controls={id('panel')} onClick={() => setOpen(!open)}>
        Filtros <span>{filtersOn ? 'Activos' : currencyLabel(draft.currency)}</span>
      </button>
      {!open && errorText ? <div className="erp-filter-error">{errorText}</div> : null}
      <div className="product-filter-panel" id={id('panel')} role="group" aria-label="Filtros" hidden={!open}>
        <label className="product-filter-field" htmlFor={id('node')}>
          <span>Nodo</span>
          <Select id={id('node')} value={draft.node} onChange={event => set({ node: event.target.value as '' | NodeId })}>
            <option value="">Todos los nodos</option>
            {NODES.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
          </Select>
        </label>
        <div className="erp-filter-dates">
          <label className="product-filter-field" htmlFor={id('from')}>
            <span>{dateLabels.from}</span>
            <Input id={id('from')} type="date" aria-label="Fecha desde" value={draft.from} {...dateProps} onChange={event => set({ from: event.target.value })} />
          </label>
          <label className="product-filter-field" htmlFor={id('to')}>
            <span>{dateLabels.to}</span>
            <Input id={id('to')} type="date" aria-label="Fecha hasta" min={draft.from || undefined} value={draft.to} {...dateProps} onChange={event => set({ to: event.target.value })} />
          </label>
        </div>
        {open ? errorText : null}
        {currencyBeforeStatus ? [currency, status] : [status, currency]}
        <LinkButton className="product-filter-clear" disabled={!filtersOn} onClick={() => onChange({ ...EMPTY_FILTERS, search: draft.search })}>
          Limpiar filtros
        </LinkButton>
      </div>
    </>
  );
}
