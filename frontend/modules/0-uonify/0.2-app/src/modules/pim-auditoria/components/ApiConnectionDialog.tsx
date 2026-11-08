import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from '@/shared/ui';
import type { FieldMap } from '../model/types';
import { display } from '../model/translations';
import { relevantProductData, type ExampleProduct } from '../model/apiConnections';
import { useAuditStore } from '../hooks/useAuditStore';
import { findByFocus } from '../hooks/useAuditFocus';
import { useApiConnection, type ApiTab } from '../hooks/useApiConnection';
import { ApiConnectView } from './ApiConnectView';
import { ApiSearchView } from './ApiSearchView';

export interface ApiConnectionDialogProps {
  onClose: () => void;
  /** «Usar Datos»: los campos que aporta el resultado elegido. */
  onUseData: (data: FieldMap) => void;
}

const TABS: Array<{ value: ApiTab; label: string }> = [
  { value: 'connect', label: 'Conectar API' },
  { value: 'search', label: 'Buscar Producto' },
];

/**
 * «Conexiones API Externas» (APIConnectionModal, E30). Simulada: mismo recorrido que el
 * original (plataforma, credenciales, prueba, búsqueda y «Usar Datos»), pero sin afirmar
 * una conexión que no ha ocurrido: el estado es «Conexión simulada» y los datos, de ejemplo.
 */
export function ApiConnectionDialog({ onClose, onUseData }: ApiConnectionDialogProps) {
  const { audit, read, ctx } = useAuditStore();
  const idPrefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [refocus, setRefocus] = useState<{ key: string; seq: number } | null>(null);
  const requestRefocus = useCallback((key: string) => setRefocus(previous => ({ key, seq: (previous?.seq ?? 0) + 1 })), []);
  const [initialQuery] = useState(() => display(audit.scrapedData?.sku || ctx.draft().sku || ''));
  const state = useApiConnection(initialQuery, requestRefocus);

  // El botón deshabilitado mientras espera pierde el foco: lo recupera al terminar.
  useEffect(() => {
    if (!refocus) return;
    const active = document.activeElement;
    if (!active || active === document.body || active.tagName === 'DIALOG') findByFocus(rootRef.current, refocus.key)?.focus();
  }, [refocus]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const enabled = TABS.filter(tab => tab.value === 'connect' || state.searchEnabled);
    const index = enabled.findIndex(tab => tab.value === state.tab);
    const next = enabled[(index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    if (!next || next.value === state.tab) return;
    event.preventDefault();
    state.setTab(next.value);
    findByFocus(rootRef.current, `api-tab-${next.value}`)?.focus();
  };

  const applyProduct = (product: ExampleProduct) => onUseData(relevantProductData(product, read().missingFields));

  return (
    <Dialog
      open
      onClose={onClose}
      title={<span>Conexiones API Externas</span>}
      description="Conecta con plataformas externas para buscar y extraer datos del producto automáticamente"
      size="xl"
      className="pim-auditoria-dialog pim-auditoria-dialog-api"
      footer={<button type="button" className="pim-btn pim-btn-outline" onClick={onClose}>Cerrar</button>}
    >
      <div className="pim-auditoria-modal pim-auditoria-api" ref={rootRef}>
        <div className="pim-subtabs pim-auditoria-api-tabs" role="tablist" aria-label="Conexiones API Externas">
          {TABS.map(tab => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${tab.value}`}
              aria-controls={`${idPrefix}-panel`}
              aria-selected={state.tab === tab.value}
              tabIndex={state.tab === tab.value ? 0 : -1}
              data-focus={`api-tab-${tab.value}`}
              disabled={tab.value === 'search' && !state.searchEnabled}
              onClick={() => state.setTab(tab.value)}
              onKeyDown={onTabKeyDown}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="pim-auditoria-api-panel" role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${state.tab}`}>
          {state.tab === 'connect'
            ? <ApiConnectView state={state} idPrefix={idPrefix} />
            : <ApiSearchView state={state} idPrefix={idPrefix} missingFields={audit.missingFields} onUse={applyProduct} />}
        </div>
      </div>
    </Dialog>
  );
}
