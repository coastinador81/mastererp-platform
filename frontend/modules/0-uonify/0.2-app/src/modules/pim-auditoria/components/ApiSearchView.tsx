import { Icon } from '@/shared/ui';
import { resultDetails, type ExampleProduct } from '../model/apiConnections';
import type { ApiConnectionState } from '../hooks/useApiConnection';

export interface ApiSearchViewProps {
  state: ApiConnectionState;
  idPrefix: string;
  missingFields: string[];
  onUse: (product: ExampleProduct) => void;
}

/** Panel «Buscar Producto»: búsqueda por SKU y resultados de ejemplo con «Usar Datos». */
export function ApiSearchView({ state, idPrefix, missingFields, onUse }: ApiSearchViewProps) {
  const queryId = `${idPrefix}-query`;
  return (
    <div className="pim-auditoria-stack">
      <div className="pim-field">
        <label className="pim-auditoria-label-lg" htmlFor={queryId}>Buscar Producto</label>
        <p className="pim-hint">Busca el producto por SKU para extraer los datos faltantes: {missingFields.join(', ')}</p>
        <div className="pim-auditoria-url-row">
          <input
            id={queryId}
            className="pim-input pim-mono"
            type="text"
            data-focus="api-query"
            value={state.searchQuery}
            placeholder="Ingresa el SKU del producto..."
            autoComplete="off"
            onChange={event => state.setSearchQuery(event.target.value)}
          />
          <button
            type="button"
            className="pim-btn pim-btn-outline pim-btn-icon pim-auditoria-search-btn"
            data-focus="api-search"
            aria-label="Buscar Producto"
            data-tooltip="Buscar Producto"
            data-tooltip-align="end"
            disabled={state.isSearching}
            onClick={() => void state.searchProduct()}
          >
            {state.isSearching ? <Icon name="loader" size={16} className="pim-spin" /> : <Icon name="search" size={16} />}
          </button>
        </div>
      </div>
      {state.searchResults.length > 0 ? (
        <div className="pim-auditoria-stack-sm">
          <span className="pim-auditoria-label-lg">Resultados de Búsqueda</span>
          {state.searchResults.map((product, index) => (
            <div key={`${product.sku}:${index}`} className="pim-card pim-auditoria-result">
              <div className="pim-auditoria-result-head">
                <div>
                  <h4 className="pim-auditoria-api-name">{product.name}</h4>
                  <p className="pim-hint">SKU: <span className="pim-mono">{product.sku}</span></p>
                  <span className="pim-badge pim-badge-outline">Fuente: {product.source}</span>
                </div>
                <button type="button" className="pim-btn pim-btn-primary pim-btn-sm" onClick={() => onUse(product)}>
                  <Icon name="arrow-right" size={14} />Usar Datos
                </button>
              </div>
              <div className="pim-auditoria-result-grid">
                {resultDetails(product).map(([key, value]) => (
                  <div key={key} className="pim-auditoria-result-row">
                    <span className="pim-auditoria-result-key">{key}:</span>
                    <span className="pim-auditoria-result-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
