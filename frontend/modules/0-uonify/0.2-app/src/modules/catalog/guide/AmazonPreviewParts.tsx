import type { CatalogProduct } from '../model/types';
import { Icon } from '@/shared/ui';
import { previewPrice, type PreviewAttribute } from './amazonPreviewModel';

export function AmazonPreviewHeader({ id, hasAplus, hasVideo }: { id: string; hasAplus: boolean; hasVideo: boolean }) {
  return <header className="amazon-preview-header">
    <div className="amazon-preview-masthead">
      <img className="amazon-preview-wordmark" src="/assets/brands/uonify-wordmark.svg" width="160" height="34" alt="Uonify" />
      <span className="amazon-preview-uony"><Icon name="uony" size={20} />Con Uony</span>
    </div>
    <div className="amazon-preview-heading"><div><span className="amazon-preview-eyebrow">VISTA PREVIA INTERACTIVA</span><strong>Tu producto, <em>en detalle.</em></strong></div><span className="amazon-preview-channel"><small>CANAL DE PUBLICACIÓN</small>Amazon.es</span></div>
    <nav className="amazon-preview-nav" aria-label="Secciones de la ficha">
      <a href={`#${id}-product`}>Ficha del producto</a>
      {hasAplus && <a href={`#${id}-brand`}>Contenido A+</a>}
      <a href={`#${id}-details`}>Detalles</a>
      {hasVideo && <a href={`#${id}-video`}>Vídeo</a>}
    </nav>
  </header>;
}
export function AmazonPreviewSignature({ sku }: { sku: string }) {
  return <div className="amazon-preview-signature">
    <div><span className="amazon-preview-signature-label">DE LA IDEA A TU PRÓXIMA VENTA</span><span className="amazon-preview-motto">Hazlo <em>posible.</em></span></div>
    <div className="amazon-preview-signature-meta"><span>Vista previa en Uonify</span><code>{sku}</code></div>
  </div>;
}
export function AmazonPrice({ value }: { value: unknown }) {
  const price = previewPrice(value);
  return price ? <div className="amazon-preview-price" aria-label={price.label}><span aria-hidden="true">{price.whole}<sup>{price.fraction}</sup><sup>€</sup></span></div> : null;
}
export function AmazonAttributes({ rows }: { rows: PreviewAttribute[] }) {
  return <table className="amazon-preview-attributes"><tbody>{rows.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.value}</td></tr>)}</tbody></table>;
}
export function AmazonBuyBox({ product }: { product: CatalogProduct }) {
  const stock = Number(product.stock);
  const stockKnown = product.stock !== undefined && product.stock !== null && product.stock !== '' && Number.isFinite(stock);
  return <aside className="amazon-preview-buybox" aria-label="Presentación de las opciones de compra">
    <span className="amazon-preview-offer-label">Oferta del producto</span>
    <AmazonPrice value={product.price} />
    <p className="amazon-preview-delivery">Selecciona tu ubicación de entrega</p>
    {stockKnown && <p className={stock > 0 ? 'amazon-preview-stock' : 'amazon-preview-unavailable'}>{stock > 0 ? 'En stock' : 'No disponible por el momento'}</p>}
    <div className="amazon-preview-quantity" aria-hidden="true">Cantidad: 1 <span>⌄</span></div>
    <button type="button" disabled className="amazon-preview-basket" title="Acción de compra no disponible en la vista previa">Añadir a la cesta</button>
    <button type="button" disabled className="amazon-preview-buy" title="Acción de compra no disponible en la vista previa">Comprar ya</button>
    {Boolean(product.sellerName || product.fulfilledBy) && <dl>{product.fulfilledBy ? <><dt>Enviado por</dt><dd>{String(product.fulfilledBy)}</dd></> : null}{product.sellerName ? <><dt>Vendido por</dt><dd>{String(product.sellerName)}</dd></> : null}</dl>}
    <p className="amazon-preview-purchase-note">Presentación de la oferta en Amazon.es</p>
  </aside>;
}
