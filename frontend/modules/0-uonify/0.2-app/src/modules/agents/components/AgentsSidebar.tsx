import clsx from 'clsx';
import { useState, type RefObject } from 'react';
import type { DrawerState } from '@/modules/catalog';
import { AGENTS_DRAWER_ID, AGENTS_SIDEBAR } from '../hooks/useAgentsDrawer';
import { MODE_LABEL, PREDEFINED_AGENTS, SECTIONS, type SectionId } from '../model/catalog';
import { useAgentsStore } from '../model/store';
import { AgentIcon, DrawerHeader, RailIcon, initialOf } from './Parts';

export interface AgentsSidebarProps {
  current: SectionId | null;
  selected: string | null;
  drawer: DrawerState;
  narrow: boolean;
  navOpen: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
  railMainRef: RefObject<HTMLButtonElement | null>;
  onRailClick: (trigger: HTMLElement) => void;
  onToggleClick: (trigger: HTMLElement) => void;
  onOpenSection: (section: SectionId) => void;
  onOpenAgent: (section: SectionId, id: string) => void;
  onCreate: () => void;
}

function toggleLabel({ open, pinned }: DrawerState, narrow: boolean): string {
  if (pinned || (open && narrow)) return 'Replegar menú';
  return open ? 'Fijar menú' : 'Expandir y fijar menú';
}

interface Row { id: string; name: string; lines: string[]; state: string }

function AgentList({ rows, selected, empty, onOpen }: { rows: Row[]; selected: string | null; empty: string; onOpen: (id: string) => void }) {
  if (!rows.length) return <div className="product-catalog-empty"><strong>{empty}</strong></div>;
  return (
    <>
      {rows.map(row => (
        <div key={row.id} className="product-catalog-row">
          <button
            type="button"
            className={clsx('product-catalog-item', row.id === selected && 'is-selected')}
            aria-current={row.id === selected ? 'true' : undefined}
            onClick={() => onOpen(row.id)}
          >
            <span className="product-item-thumb agents-item-mark" aria-hidden="true">{initialOf(row.name)}</span>
            <span>
              <strong>{row.name}</strong>
              {row.lines.map(text => <small key={text}>{text}</small>)}
            </span>
            <span className="pim-badge pim-badge-green agents-row-state">{row.state}</span>
          </button>
        </div>
      ))}
    </>
  );
}

/**
 * Panel izquierdo del servicio Agentes, con la estructura del catálogo de Producto: raíl
 * plegado con un icono por apartado y panel con el menú o con la lista de agentes abierta.
 */
export function AgentsSidebar(props: AgentsSidebarProps) {
  const { current, selected, drawer, narrow, navOpen, toggleRef, railMainRef } = props;
  const drafts = useAgentsStore(state => state.drafts);
  const listing = current === 'predeterminados' || current === 'personalizados' ? current : null;
  const [view, setView] = useState<'menu' | 'list'>(listing ? 'list' : 'menu');
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    setView(listing ? 'list' : 'menu');
  }
  const label = toggleLabel(drawer, narrow);
  const list = view === 'list' ? listing : null;

  const predefined: Row[] = PREDEFINED_AGENTS.map(agent => ({ id: agent.id, name: agent.name, lines: [`${MODE_LABEL[agent.mode]} · ${agent.module}`], state: 'Listo' }));
  const custom: Row[] = drafts.map(draft => ({ id: draft.id, name: draft.name, lines: [`${MODE_LABEL[draft.mode]} · ${draft.module}`], state: 'Borrador' }));

  return (
    <div className="product-sidebar product-sidebar-left" data-product-sidebar={AGENTS_SIDEBAR}>
      <div className="product-sidebar-control">
        <button
          ref={toggleRef}
          type="button"
          className="product-sidebar-toggle"
          aria-controls={AGENTS_DRAWER_ID}
          aria-expanded={drawer.open}
          aria-label={label}
          title={label}
          onClick={event => props.onToggleClick(event.currentTarget)}
        >
          <RailIcon name="panel" />
        </button>
      </div>
      <aside className="product-edge product-edge-left" aria-label="Agentes, menú e hilos" inert={drawer.open}>
        {SECTIONS.map((section, index) => (
          <button
            key={section.id}
            ref={index === 0 ? railMainRef : undefined}
            type="button"
            className={clsx('agents-edge-item', section.id === current && 'is-active')}
            data-product-drawer="agentes"
            aria-expanded={drawer.open}
            aria-controls={AGENTS_DRAWER_ID}
            aria-label={section.label}
            data-tooltip={section.label}
            data-tooltip-pos="right"
            onClick={event => {
              const lists = section.id === 'predeterminados' || section.id === 'personalizados';
              setView(lists ? 'list' : 'menu');
              props.onOpenSection(section.id);
              if (lists && !drawer.open) props.onRailClick(event.currentTarget);
            }}
          >
            <AgentIcon name={section.icon} />
          </button>
        ))}
        <button
          type="button"
          className="product-edge-threads agents-edge-threads"
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
      <aside className="product-drawer product-catalog-drawer" id={AGENTS_DRAWER_ID} aria-label={list === 'predeterminados' ? 'Agentes predeterminados' : list === 'personalizados' ? 'Agentes personalizados' : 'Menú de Agentes'} inert={!drawer.open}>
        {list ? (
          <>
            <DrawerHeader
              eyebrow={list === 'predeterminados' ? `${PREDEFINED_AGENTS.length} agentes por módulo` : `${drafts.length} ${drafts.length === 1 ? 'agente' : 'agentes'}`}
              title={list === 'predeterminados' ? 'Agentes predeterminados' : 'Agentes personalizados'}
              navOpen={navOpen}
              onBack={() => setView('menu')}
            />
            <div className="product-drawer-actions agents-drawer-actions">
              <button type="button" className="pim-btn pim-btn-primary pim-btn-sm" onClick={props.onCreate}>Crear agente</button>
            </div>
            <div className="product-catalog-list">
              <AgentList
                rows={list === 'predeterminados' ? predefined : custom}
                selected={selected}
                empty="Aún no has creado agentes personalizados. Usa «Crear agente» para diseñar el primero."
                onOpen={id => props.onOpenAgent(list, id)}
              />
            </div>
          </>
        ) : (
          <>
            <DrawerHeader eyebrow="Centro de agentes" title="Agentes" navOpen={navOpen} />
            <div className="product-catalog-list agents-menu-scroll">
              <button type="button" className="pim-btn pim-btn-primary agents-menu-create" onClick={props.onCreate}>Crear agente</button>
              <nav className="agents-menu" aria-label="Apartados de Agentes">
                {SECTIONS.map(section => (
                  <button
                    key={section.id}
                    type="button"
                    className={clsx('agents-menu-item', section.id === current && 'is-active')}
                    aria-current={section.id === current ? 'page' : undefined}
                    onClick={() => {
                      if (section.id === 'predeterminados' || section.id === 'personalizados') setView('list');
                      props.onOpenSection(section.id);
                    }}
                  >
                    <AgentIcon name={section.icon} />
                    <span>{section.label}</span>
                    {section.id === 'predeterminados' ? <small>{PREDEFINED_AGENTS.length}</small> : section.id === 'personalizados' && drafts.length ? <small>{drafts.length}</small> : null}
                  </button>
                ))}
              </nav>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
