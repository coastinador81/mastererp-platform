import { USE_MOCKS } from '@/shared/api/config';
import { usePimValue, type PimEdited } from '@/shared/pim';
import type { CatalogProduct } from '../model/types';
import { ProductIcon } from './ProductIcon';

export interface ProductHeaderProps {
  product: CatalogProduct | null;
  /** Clave del almacén del PIM ('__new__' o el SKU). */
  pimKey: string;
  onDelete: () => void;
  onClose: (detail: number) => void;
  onPublish: () => void;
  incidentCount?: number;
  onOpenIncidents?: () => void;
}

/**
 * Cabecera de la ficha (prototipo: ProductHeader de app-shell.js): imagen, nombre y
 * SKU en vivo (siguen lo que se escribe en las pestañas), estado, iconos de eliminar
 * y cerrar arriba y «Publicar» abajo, justo encima de las pestañas.
 */
export function ProductHeader({ product, pimKey, onDelete, onClose, onPublish, incidentCount = 0, onOpenIncidents }: ProductHeaderProps) {
  const edited = usePimValue<PimEdited>(pimKey, 'edited', {});
  const isNew = !product;
  const name = String(edited.name ?? product?.name ?? '') || 'Nuevo Producto';
  const sku = String(edited.sku ?? product?.sku ?? '') || 'Sin asignar';
  return (
    <header className="product-center-header" data-source-component="ProductHeader">
      <div className="product-source-header-summary">
        <div className="product-heading-mark">
          {product?.image ? <img src={product.image} alt={product.name} /> : <ProductIcon name="image" />}
        </div>
        <div className="product-center-title">
          <h1 data-product-header-name>{name}</h1>
          <p>SKU: <span data-product-header-sku>{sku}</span></p>
          <span className="product-source-status">{isNew ? 'Creando...' : 'Borrador'}</span>
          {incidentCount > 0 && <button type="button" className="product-incidents-badge" onClick={onOpenIncidents}>{incidentCount} {incidentCount === 1 ? 'incidencia requiere' : 'incidencias requieren'} atención</button>}
        </div>
        <div className="product-header-side">
          <div className="product-header-icons">
            {isNew ? null : (
              <button
                type="button"
                className="product-icon-button product-header-close"
                aria-label="Eliminar producto"
                data-tooltip="Eliminar producto"
                data-tooltip-pos="below"
                onClick={onDelete}
              >
                <ProductIcon name="trash" />
              </button>
            )}
            <button
              type="button"
              className="product-icon-button product-sheet-close"
              aria-label="Cerrar ficha"
              data-tooltip={isNew ? 'Cerrar ficha (se guarda el borrador)' : 'Cerrar ficha'}
              data-tooltip-pos="below"
              data-tooltip-align="end"
              onClick={event => onClose(event.detail)}
            >
              <ProductIcon name="close" />
            </button>
          </div>
          <button
            type="button"
            className="primary-action product-publish-button"
            disabled={!USE_MOCKS}
            title={!USE_MOCKS ? 'Publicación en Amazon en preparación' : undefined}
            aria-disabled={isNew || !USE_MOCKS || undefined}
            data-tooltip={isNew ? 'Guarda el producto para publicarlo' : undefined}
            data-tooltip-pos={isNew ? 'below' : undefined}
            data-tooltip-align={isNew ? 'end' : undefined}
            onClick={onPublish}
          >
            <ProductIcon name="send" />
            Publicar
          </button>
        </div>
      </div>
    </header>
  );
}
