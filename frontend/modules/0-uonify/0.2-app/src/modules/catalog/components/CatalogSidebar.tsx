import { Icon } from '@/shared/ui';
import { USE_MOCKS } from '@/shared/api/config';
import { IncidentsAccessButton, useIncidents } from '@/modules/product-incidents';
import { useMemo, type KeyboardEvent, type RefObject } from 'react';
import { drawerToggleLabel, type DrawerState } from '../model/layout';
import { filterProducts } from '../model/catalogRules';
import type { CatalogProduct } from '../model/types';
import { useCatalogStore } from '../hooks/useCatalogStore';
import { BulkPublishBar } from './BulkPublishBar';
import { CatalogList } from './CatalogList';
import { CatalogSearch } from './CatalogSearch';
import { RailIcon, ProductIcon } from './ProductIcon';

export interface CatalogSidebarProps {
  products: CatalogProduct[];
  status: 'pending' | 'error' | 'success';
  selectedSku: string | null;
  drawer: DrawerState;
  /** La columna del módulo es estrecha (el catálogo no se fija). */
  narrow: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
  railMainRef: RefObject<HTMLButtonElement | null>;
  onRailClick: (trigger: HTMLElement, fromRail: boolean) => void;
  onToggleClick: (trigger: HTMLElement) => void;
  /** Panel «Hilos y proyectos» abierto (lo abre el espacio con los botones data-open-nav). */
  navOpen: boolean;
  onCreate: () => void;
  onImport: () => void;
  onOpenProduct: (sku: string) => void;
  onPublish: (products: CatalogProduct[]) => void;
  onRetry: () => void;
  onViewIncidents?: () => void;
}

const productsLabel = (count: number) => `${count} ${count === 1 ? 'producto' : 'productos'}`;

/**
 * Catálogo a la izquierda de Producto (prototipo: .product-sidebar-left): raíl plegado
 * (+ Nuevo producto, Catálogo, Hilos y proyectos) y panel con Importar, Nuevo
 * producto, búsqueda, filtros, lista y barra de selección para publicar.
 */
export function CatalogSidebar(props: CatalogSidebarProps) {
  const { products, status, selectedSku, drawer, narrow, toggleRef, railMainRef, navOpen } = props;
  const { query: incidents } = useIncidents({ status: 'active' }, !!props.onViewIncidents && !USE_MOCKS);
  const incidentAccess = { data: incidents.data, loading: incidents.isPending, failed: incidents.isError };
  const selection = useCatalogStore(state => state.selection);
  const filters = useCatalogStore(state => state.filters);
  const setSelected = useCatalogStore(state => state.setSelected);
  const setSelection = useCatalogStore(state => state.setSelection);
  const setFilters = useCatalogStore(state => state.setFilters);
  const { open } = drawer;
  const count = products.length;
  const visible = useMemo(() => filterProducts(products, filters), [products, filters]);
  // Solo cuentan los que siguen en el catálogo.
  const checked = useMemo(() => selection.filter(sku => products.some(item => item.sku === sku)), [selection, products]);
  const allChecked = visible.length > 0 && visible.every(item => checked.includes(item.sku));
  const toggleLabel = drawerToggleLabel(drawer, narrow);

  const toggleAll = () => {
    const visibleSkus = visible.map(item => item.sku);
    setSelection(allChecked ? checked.filter(sku => !visibleSkus.includes(sku)) : [...checked, ...visibleSkus]);
  };

  // Tab desde el botón de la cabecera, con el catálogo abierto: al primer control del panel.
  const onToggleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Tab' || event.shiftKey || !open) return;
    const first = event.currentTarget.closest('.product-sidebar')?.querySelector<HTMLElement>('#product-catalog-drawer button');
    if (!first) return;
    event.preventDefault();
    first.focus();
  };

  return (
    <div className="product-sidebar product-sidebar-left" data-product-sidebar="catalog">
      <div className="product-sidebar-control">
        <button
          ref={toggleRef}
          type="button"
          className="product-sidebar-toggle"
          data-product-toggle="catalog"
          aria-controls="product-catalog-drawer"
          aria-expanded={open}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={event => props.onToggleClick(event.currentTarget)}
          onKeyDown={onToggleKeyDown}
        >
          <RailIcon name="panel" />
        </button>
      </div>
      <aside className="product-edge product-edge-left" aria-label="Producto, catálogo e hilos" inert={open}>
        <button type="button" className="product-edge-new" aria-label="Nuevo producto" data-tooltip="Nuevo producto" data-tooltip-pos="right" onClick={props.onCreate}>
          <ProductIcon name="plus" />
        </button>
        <button
          ref={railMainRef}
          type="button"
          className="product-edge-main"
          data-product-drawer="catalog"
          aria-expanded={open}
          aria-controls="product-catalog-drawer"
          aria-label={`Catálogo, ${productsLabel(count)}`}
          data-tooltip="Catálogo"
          data-tooltip-pos="right"
          onClick={event => props.onRailClick(event.currentTarget, true)}
        >
          <RailIcon name="catalog" />
          {count ? <b aria-hidden="true">{count}</b> : null}
        </button>
        <button
          type="button"
          className="product-edge-threads"
          data-open-nav
          aria-controls="nav-drawer"
          aria-expanded={navOpen}
          aria-label="Hilos y proyectos"
          data-tooltip="Hilos y proyectos"
          data-tooltip-pos="right"
        >
          <RailIcon name="threads" />
        </button>
        {props.onViewIncidents && <IncidentsAccessButton {...incidentAccess} compact onClick={props.onViewIncidents} />}
      </aside>
      <aside className="product-drawer product-catalog-drawer" id="product-catalog-drawer" aria-label="Catálogo de productos" inert={!open}>
        <header>
          <div>
            <span className="product-drawer-eyebrow">{productsLabel(count)}</span>
            <h2>Catálogo</h2>
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
        <div className="product-drawer-actions">
          <button type="button" className={USE_MOCKS ? "primary-action" : "secondary-action"} disabled={!USE_MOCKS} title={!USE_MOCKS ? "Pide a Uony que importe tus materiales desde la conversación" : undefined} onClick={props.onImport}>Importar</button>
          <button type="button" className={USE_MOCKS ? "secondary-action" : "primary-action"} onClick={props.onCreate}>Nuevo producto</button>
          {!USE_MOCKS && <button type="button" className="product-icon-button" aria-label="Actualizar catálogo" title="Actualizar catálogo" onClick={props.onRetry}><Icon name="refresh-cw" /></button>}
        </div>
        <CatalogSearch />
        {props.onViewIncidents && <IncidentsAccessButton {...incidentAccess} onClick={props.onViewIncidents} />}
        <CatalogList
          products={visible}
          hasCatalog={count > 0}
          status={status}
          selectedSku={selectedSku}
          checked={checked}
          onCheck={setSelected}
          onOpen={props.onOpenProduct}
          onRetry={props.onRetry}
          onClearSearch={() => setFilters({ search: '', status: 'all', source: 'all' })}
        />
        {USE_MOCKS && <BulkPublishBar
          count={checked.length}
          allChecked={allChecked}
          onToggleAll={toggleAll}
          onClear={() => setSelection([])}
          onPublish={() => props.onPublish(products.filter(item => checked.includes(item.sku)))}
        />}
      </aside>
    </div>
  );
}
