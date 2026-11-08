import { useId } from 'react';
import { AplusPreviewBody, type AplusSlice } from '@/modules/pim-aplus';
import type { CatalogProduct } from '../model/types';
import { AmazonAttributes, AmazonBuyBox, AmazonPreviewHeader, AmazonPreviewSignature, AmazonPrice } from './AmazonPreviewParts';
import { productAttributes, type PreviewImage, type PreviewVideo } from './amazonPreviewModel';
import { AmazonGallery } from './AmazonGallery';
import './amazonPreview.css';
import './previewBrand.css';

interface Props { product: CatalogProduct; images: PreviewImage[]; movie?: PreviewVideo; aplus: AplusSlice; bullets?: string[] | null }
/** Presentación compartida por el visor del cliente y la muestra pública, sin sesión ni mutaciones. */
export function AmazonProductView({ product, images, movie, aplus, bullets }: Props) {
  const id = useId();
  const modules = aplus.content?.[String(product.asin || 'local')]?.data.modules || [];
  const points = bullets || (Array.isArray(product.bullets) ? product.bullets as string[] : []);
  const attributes = productAttributes(product);
  const description = typeof product.description === 'string' ? product.description.replace(/<\/(?:p|h[1-6]|li)>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() : '';
  return <article className="amazon-preview" aria-label="Vista previa de Amazon">
    <AmazonPreviewHeader id={id} hasAplus={modules.length > 0} hasVideo={Boolean(movie)} />
    <div className="amazon-preview-content">
      <div className="amazon-preview-breadcrumb">{String(product.category || 'Juguetes y juegos')}</div>
      <div className="amazon-preview-main" id={`${id}-product`}>
        <AmazonGallery images={images} movie={movie} product={product} />
        <div className="amazon-preview-summary">
          <h3 className="amazon-preview-title">{product.name}</h3>
          <a className="amazon-preview-brand" href={`#${id}-${modules.length ? 'brand' : 'details'}`}>Marca: {String(product.brand || 'Uonify')}</a>
          <hr />
          <AmazonPrice value={product.price} />
          <AmazonAttributes rows={attributes.slice(0, 5)} />
          <a className="amazon-preview-details-link" href={`#${id}-details`}>Ver todos los detalles del producto</a>
          <hr /><h4>Acerca de este producto</h4>
          <ul className="amazon-preview-bullets">{points.map((point, index) => <li key={index}>{point}</li>)}</ul>
        </div>
        <AmazonBuyBox product={product} />
      </div>
      {modules.length > 0 && <section className="amazon-preview-aplus" id={`${id}-brand`}><div className="amazon-preview-section-heading"><span>LA HISTORIA DE TU PRODUCTO</span><h4>Contenido A+</h4></div><div className="amazon-preview-aplus-content">{modules.map(module => <AplusPreviewBody key={module.id} module={module} />)}</div></section>}
      <section className="amazon-preview-details" id={`${id}-details`}><h4>Información del producto</h4><div className="amazon-preview-detail-grid"><div><h5>Detalles técnicos</h5><AmazonAttributes rows={attributes} /></div><div><h5>Información adicional</h5><AmazonAttributes rows={[
        { name: 'Referencia del producto', value: product.sku },
        ...(product.asin ? [{ name: 'ASIN', value: String(product.asin) }] : []),
        ...(product.category ? [{ name: 'Categoría', value: String(product.category) }] : []),
      ]} /></div></div></section>
      {description && <section className="amazon-preview-description"><h4>Descripción del producto</h4>{description.split('\n').filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>}
      {movie && <section className="amazon-preview-video" id={`${id}-video`}><h4>Vídeos del producto</h4><video controls playsInline preload="metadata" poster={movie.poster} src={movie.url} aria-label={movie.title || 'Vídeo del producto'} /></section>}
      <section className="amazon-preview-reviews"><h4>Opiniones de clientes</h4><p>No hay reseñas de clientes.</p></section>
    </div>
    <AmazonPreviewSignature sku={product.sku} />
  </article>;
}
