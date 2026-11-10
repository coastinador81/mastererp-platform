import clsx from 'clsx';
import { useId, useState } from 'react';
import { LinkButton, Select } from '@/shared/ui';
import { stageOf, useSuggestions } from '../hooks/useSuggestions';
import { NODES, nodeName, type NodeId } from '../model/demoPurchases';
import { FINANCE_ICON_PATHS } from '../model/menu';
import { STAGE_OPTIONS, SUGGESTIONS, bolivares, changedProposal, stageLabel, suggestionReference, type Stage } from '../model/suggestions';
import { DrawerHeader } from './DrawerHeader';

export interface SuggestionsPanelProps {
  selected: string | null;
  navOpen: boolean;
  onBack: () => void;
  onOpen: (reference: string) => void;
}

const FOOTNOTE = 'Stock, cantidades y precios ficticios. Dos revisiones visuales sin autenticación ni permisos reales; IA y reglas pendientes. Solo memoria de esta pestaña: al recargar se pierden observaciones, revisiones y borradores. No se envían órdenes ni se genera deuda.';

/**
 * Lista de Sugerencias de compras en el panel lateral, con las clases del catálogo de
 * Producto y lo que enseña la demo del equipo (PurchaseSuggestionsPreview.jsx): filtros de
 * nodo y de etapa de aprobación, y cada sugerencia con su producto, proveedor, estimado,
 * nodo, etapa y cambios («Cambios / prioridad»), con los textos literales.
 */
export function SuggestionsPanel({ selected, navOpen, onBack, onOpen }: SuggestionsPanelProps) {
  const nodeReviews = useSuggestions(state => state.nodeReviews);
  const approved = useSuggestions(state => state.approved);
  const { node, stage } = useSuggestions(state => state.filters);
  const setFilters = useSuggestions(state => state.setFilters);
  const [open, setOpen] = useState(false);
  const uid = useId();
  const active = Boolean(node || stage);
  const visible = SUGGESTIONS.filter(item => (!node || item.node === node) && (!stage || stageOf({ nodeReviews, approved }, item.id) === stage));
  return (
    <>
      <DrawerHeader eyebrow={`${visible.length} sugerencias DEMO`} liveEyebrow title="Sugerencias de compras" navOpen={navOpen} onBack={onBack} />
      <p className="erp-drawer-description">
        Revisión del nodo → Jefe de compras → Compras. <span className="product-source-status">DEMO · IA no conectada</span>
      </p>
      <button type="button" className="product-filter-trigger erp-filter-first" aria-expanded={open} aria-controls={`${uid}-panel`} onClick={() => setOpen(value => !value)}>
        Filtros <span>{active ? 'Activos' : 'Todos'}</span>
      </button>
      <div className="product-filter-panel" id={`${uid}-panel`} role="group" aria-label="Filtros" hidden={!open}>
        <label className="product-filter-field" htmlFor={`${uid}-node`}>
          <span>Nodo</span>
          <Select id={`${uid}-node`} value={node} onChange={event => setFilters({ node: event.target.value as '' | NodeId })}>
            <option value="">Todos los nodos</option>
            {NODES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </label>
        <label className="product-filter-field" htmlFor={`${uid}-stage`}>
          <span>Aprobación</span>
          <Select id={`${uid}-stage`} value={stage} onChange={event => setFilters({ stage: event.target.value as '' | Stage })}>
            <option value="">Todas las etapas</option>
            {STAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </label>
        <LinkButton className="product-filter-clear" disabled={!active} onClick={() => setFilters({ node: '', stage: '' })}>
          Limpiar filtros
        </LinkButton>
      </div>
      <div className="product-catalog-list">
        {visible.length ? visible.map(item => {
          const reference = suggestionReference(item);
          const current = stageOf({ nodeReviews, approved }, item.id);
          const final = approved.find(row => row.source === reference)?.fromSuggestion;
          const adjusted = nodeReviews[item.id]?.proposal;
          const changed = Boolean(adjusted && changedProposal(item, adjusted));
          const changes = final?.priority ? 'Prioritaria' : changed ? 'Modificada por el nodo' : 'Sin cambios confirmados';
          const byPurchasing = Boolean(final && adjusted && changedProposal(adjusted, final.final));
          return (
            <div key={item.id} className="product-catalog-row">
              <button
                type="button"
                className={clsx('product-catalog-item', reference === selected && 'is-selected')}
                aria-current={reference === selected ? 'true' : undefined}
                onClick={() => onOpen(reference)}
              >
                <span className="product-item-thumb erp-item-thumb erp-suggestion-thumb" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" dangerouslySetInnerHTML={{ __html: FINANCE_ICON_PATHS.summary }} />
                </span>
                <span>
                  <strong className="pim-mono">{reference}</strong>
                  <small>{item.product}</small>
                  <small>{bolivares(item.quantity * item.price)} · {item.supplier}</small>
                  <small>{nodeName(item.node)} · {stageLabel(current)}</small>
                  <small>{changes}{byPurchasing ? ' · Modificada por Compras' : ''}</small>
                </span>
                <span className="product-item-state erp-item-state" data-tone={final?.priority || changed ? 'warning' : 'neutral'} aria-hidden="true" />
              </button>
            </div>
          );
        }) : (
          <div className="product-catalog-empty">
            <strong>No hay sugerencias que coincidan con el nodo y la etapa de aprobación.</strong>
          </div>
        )}
        <p className="pim-section-sub erp-note erp-drawer-footnote">{FOOTNOTE}</p>
      </div>
    </>
  );
}
