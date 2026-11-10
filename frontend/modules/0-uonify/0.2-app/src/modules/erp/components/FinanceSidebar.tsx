import { useState, type RefObject } from 'react';
import type { DrawerState } from '@/modules/catalog';
import { FINANCE_DRAWER_ID, FINANCE_SIDEBAR } from '../hooks/useFinanceDrawer';
import { useMastererp } from '../hooks/useMastererp';
import { FINANCE_MENU, findApartado } from '../model/menu';
import { listOf } from '../model/lists';
import type { ApartadoMode } from '../model/mode';
import { SUGGESTIONS_ROUTE } from '../model/paths';
import type { RealApartado } from '../model/real';
import { DrawerHeader } from './DrawerHeader';
import { ErpConnectionCard } from './ErpConnectionCard';
import { FinanceIcon, FinanceMenu } from './FinanceMenu';
import { DocumentsPanel } from './DocumentsPanel';
import { RealListPanel } from './RealListPanel';
import { SuggestionsPanel } from './SuggestionsPanel';
import { RailIcon } from './RailIcon';

export interface FinanceSidebarProps {
  /** Apartado abierto en la URL (vista=… del equipo), o null en el inicio de Finanzas. */
  current: string | null;
  /** Apartado abierto con datos reales (cuenta del ERP conectada y permiso en el contexto). */
  real?: RealApartado;
  modeOf: (route: string | undefined) => ApartadoMode;
  selected: string | null;
  drawer: DrawerState;
  narrow: boolean;
  navOpen: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
  railMainRef: RefObject<HTMLButtonElement | null>;
  onRailClick: (trigger: HTMLElement) => void;
  onToggleClick: (trigger: HTMLElement) => void;
  onOpenApartado: (route: string) => void;
  onOpenDocument: (reference: string) => void;
}

/** Igual que el catálogo (catalog/model/layout.ts, drawerToggleLabel), con «menú». */
function toggleLabel({ open, pinned }: DrawerState, narrow: boolean): string {
  if (pinned || (open && narrow)) return 'Replegar menú';
  return open ? 'Fijar menú' : 'Expandir y fijar menú';
}

/** Los dos primeros grupos abiertos, como el menú del equipo, más el del apartado abierto. */
const initialGroups = (current: string | null) =>
  new Set([...FINANCE_MENU.slice(0, 2).map(group => group.number), ...(current ? [findApartado(current)?.group.number ?? ''] : [])]);

/**
 * Panel izquierdo del servicio ERP con la estructura del catálogo de Producto
 * (CatalogSidebar): raíl plegado con un icono por grupo del menú del equipo, y panel con
 * el menú de Finanzas o con la lista del apartado abierto (Compras, Órdenes o Sugerencias).
 */
export function FinanceSidebar(props: FinanceSidebarProps) {
  const { current, real, selected, drawer, narrow, navOpen, toggleRef, railMainRef } = props;
  // Cambiar de espacio o de empresa vuelve a la primera página de la lista real.
  const scopeKey = useMastererp(state => `${state.tenant}:${state.company}`);
  const [view, setView] = useState<'menu' | 'list'>(current ? 'list' : 'menu');
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => initialGroups(current));
  // Al cambiar de apartado en la URL, el panel enseña su lista (o el menú, sin apartado).
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    setView(current ? 'list' : 'menu');
  }
  const { open } = drawer;
  const label = toggleLabel(drawer, narrow);

  const showGroup = (number: string, show = true) => setOpenGroups(groups => {
    const next = new Set(groups);
    if (show) next.add(number);
    else next.delete(number);
    return next;
  });
  const openApartado = (route: string) => {
    setView('list');
    props.onOpenApartado(route);
  };
  const realList = view === 'list' ? real : undefined;
  const list = view === 'list' && !real ? listOf(current) : undefined;
  const suggestions = view === 'list' && current === SUGGESTIONS_ROUTE;

  return (
    <div className="product-sidebar product-sidebar-left" data-product-sidebar={FINANCE_SIDEBAR}>
      <div className="product-sidebar-control">
        <button
          ref={toggleRef}
          type="button"
          className="product-sidebar-toggle"
          aria-controls={FINANCE_DRAWER_ID}
          aria-expanded={open}
          aria-label={label}
          title={label}
          onClick={event => props.onToggleClick(event.currentTarget)}
        >
          <RailIcon name="panel" />
        </button>
      </div>
      <aside className="product-edge product-edge-left" aria-label="Finanzas, menú e hilos" inert={open}>
        {FINANCE_MENU.map((group, index) => (
          <button
            key={group.number}
            ref={index === 0 ? railMainRef : undefined}
            type="button"
            className="erp-edge-group"
            data-product-drawer="finanzas"
            aria-expanded={open}
            aria-controls={FINANCE_DRAWER_ID}
            aria-label={group.name}
            data-tooltip={group.name}
            data-tooltip-pos="right"
            onClick={event => {
              setView('menu');
              showGroup(group.number);
              props.onRailClick(event.currentTarget);
            }}
          >
            <FinanceIcon name={group.icon} />
          </button>
        ))}
        <button
          type="button"
          className="product-edge-threads erp-edge-threads"
          data-open-nav
          aria-controls="nav-drawer"
          aria-expanded={navOpen}
          aria-label="Hilos y proyectos"
          data-tooltip="Hilos y proyectos"
          data-tooltip-pos="right"
        >
          <RailIcon name="threads" />
        </button>
      </aside>
      <aside className="product-drawer product-catalog-drawer" id={FINANCE_DRAWER_ID} aria-label={realList ? realList.title : list ? list.title : suggestions ? 'Sugerencias de compras' : 'Menú de Finanzas'} inert={!open}>
        {realList ? (
          <RealListPanel key={`${realList.route}:${scopeKey}`} apartado={realList} selected={selected} navOpen={navOpen} onBack={() => setView('menu')} onOpen={props.onOpenDocument} />
        ) : list ? (
          <DocumentsPanel key={list.route} list={list} selected={selected} navOpen={navOpen} onBack={() => setView('menu')} onOpen={props.onOpenDocument} />
        ) : suggestions ? (
          <SuggestionsPanel selected={selected} navOpen={navOpen} onBack={() => setView('menu')} onOpen={props.onOpenDocument} />
        ) : (
          <>
            <DrawerHeader eyebrow="Finanzas" title="Administración" navOpen={navOpen} />
            <div className="product-catalog-list erp-menu-scroll">
              <ErpConnectionCard />
              <FinanceMenu openGroups={openGroups} current={current} modeOf={props.modeOf} onToggleGroup={showGroup} onOpenApartado={openApartado} />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
