import { USE_MOCKS } from '@/shared/api/config';
import clsx from 'clsx';
import type { CatalogProduct } from '../model/types';

export interface CatalogListProps {
  products: CatalogProduct[];
  /** Hay productos en el catálogo (aunque la búsqueda no encuentre ninguno). */
  hasCatalog: boolean;
  status: 'pending' | 'error' | 'success';
  selectedSku: string | null;
  checked: string[];
  onCheck: (sku: string, on: boolean) => void;
  onOpen: (sku: string) => void;
  onRetry: () => void;
  onClearSearch: () => void;
}

/**
 * Lista del catálogo (prototipo: renderProductWorkspace, filas del catálogo): casilla
 * para publicar varios, miniatura, nombre, SKU y marca, y el punto de ficha guardada.
 */
export function CatalogList({ products, hasCatalog, status, selectedSku, checked, onCheck, onOpen, onRetry, onClearSearch }: CatalogListProps) {
  if (status === 'pending') {
    return (
      <div className="product-catalog-list">
        <p className="product-catalog-status" role="status">Cargando catálogo…</p>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="product-catalog-list">
        <div className="product-catalog-empty" role="alert">
          <strong>No se ha podido cargar el catálogo</strong>
          <span>Revisa tu conexión e inténtalo de nuevo.</span>
          <button type="button" className="secondary-action product-catalog-retry" onClick={onRetry}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!hasCatalog) {
    return (
      <div className="product-catalog-list">
        <div className="product-catalog-empty">
          <img src="/assets/product-icons/catalogo.png" alt="" />
          <strong>Tu catálogo empieza aquí</strong>
          <span>{USE_MOCKS ? 'Importa productos o crea la primera ficha.' : 'Crea tu primera ficha o pídeselo a Uony.'}</span>
        </div>
      </div>
    );
  }
  if (!products.length) {
    return (
      <div className="product-catalog-list">
        <div className="product-catalog-empty">
          <strong>No se encontraron productos</strong>
          <span>Prueba con otro nombre o SKU, o cambia los filtros.</span>
          <button type="button" className="secondary-action product-catalog-retry" onClick={onClearSearch}>Limpiar búsqueda</button>
        </div>
      </div>
    );
  }
  return (
    <div className="product-catalog-list">
      {products.map(item => {
        const isChecked = checked.includes(item.sku);
        return (
          <div key={item.sku} className={clsx('product-catalog-row', isChecked && 'is-checked')}>
            {USE_MOCKS && <label className="product-catalog-check">
              <input
                type="checkbox"
                data-select-product={item.sku}
                checked={isChecked}
                onChange={event => onCheck(item.sku, event.target.checked)}
                aria-label={`Seleccionar «${item.name}» para publicar`}
              />
            </label>}
            <button
              type="button"
              className={clsx('product-catalog-item', item.sku === selectedSku && 'is-selected')}
              data-product-sku={item.sku}
              aria-current={item.sku === selectedSku ? 'true' : undefined}
              onClick={() => onOpen(item.sku)}
            >
              <span className="product-item-thumb" aria-hidden="true">
                {item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" /> : '◇'}
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>{item.sku}{item.brand ? ` · ${item.brand}` : ''}</small>
              </span>
              <span className="product-item-state" role="img" aria-label="Ficha guardada" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
