import { useState } from 'react';
import { Icon } from '@/shared/ui';
import type { CatalogProduct } from '../model/types';
import type { PreviewImage, PreviewVideo } from './amazonPreviewModel';

/** Galería de la revisión actual: imágenes y vídeo comparten el mismo visor. */
export function AmazonGallery({ images, movie, product }: { images: PreviewImage[]; movie?: PreviewVideo; product: CatalogProduct }) {
  const [selected, setSelected] = useState('');
  const [zoom, setZoom] = useState(false);
  const current = images.find(image => image.id === selected) || images[0];
  const isMovie = selected === '__video__' && movie;
  const items = [...images.map(image => image.id), ...(movie ? ['__video__'] : [])];
  const active = isMovie ? images.length : Math.max(0, images.indexOf(current));
  const select = (id: string) => { setSelected(id); setZoom(false); };
  const step = (direction: number) => select(items[(active + direction + items.length) % items.length]);
  return <div className="amazon-preview-gallery">
    <div className="amazon-preview-thumbs" aria-label="Galería del producto" onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const next = (active + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      select(items[next]);
      event.currentTarget.querySelectorAll('button')[next]?.focus();
    }}>
      {images.map((image, index) => <button type="button" key={image.id} onClick={() => select(image.id)} aria-label={`Ver imagen ${index + 1}`} aria-pressed={!isMovie && current?.id === image.id}><img src={image.url} alt="" loading="lazy" /></button>)}
      {movie && <button type="button" className="amazon-preview-video-thumb" onClick={() => select('__video__')} aria-label="Ver vídeo del producto" aria-pressed={Boolean(isMovie)}>
        <img src={movie.poster || product.image} alt="" loading="lazy" /><span className="amazon-preview-play"><Icon name="play" size={17} /></span><small>VÍDEO</small>
      </button>}
    </div>
    <div className="amazon-preview-media">
      <div className="amazon-preview-stage" data-zoom={zoom && !isMovie}>
        {isMovie ? <video key={movie.id} controls playsInline preload="metadata" poster={movie.poster} src={movie.url} aria-label={movie.title || 'Vídeo del producto'} /> :
          <button type="button" className="amazon-preview-image-button" aria-label={zoom ? 'Reducir imagen seleccionada' : 'Ampliar imagen seleccionada'} aria-pressed={zoom} onClick={() => setZoom(value => !value)}>
            <img className="amazon-preview-hero" src={current?.url || product.image} alt={current?.name || product.name} />
          </button>}
      </div>
      <div className="amazon-preview-media-tools">
        <button type="button" onClick={() => step(-1)} aria-label="Contenido anterior" disabled={items.length < 2}><Icon name="chevron-left" size={18} /></button>
        <span aria-live="polite">{isMovie ? 'Vídeo del producto' : `Imagen ${active + 1} de ${images.length || 1}`}</span>
        <button type="button" onClick={() => step(1)} aria-label="Contenido siguiente" disabled={items.length < 2}><Icon name="chevron-right" size={18} /></button>
      </div>
      {!isMovie && <button type="button" className="amazon-preview-zoom-control" aria-pressed={zoom} onClick={() => setZoom(value => !value)}>{zoom ? 'Reducir imagen' : 'Ampliar imagen'}</button>}
      <span className="amazon-preview-media-caption">{isMovie ? 'Reproduce el vídeo y comprueba cada detalle.' : zoom ? 'Desplázate por la imagen para ver cada detalle.' : 'Pulsa la imagen para ampliarla.'}</span>
    </div>
  </div>;
}
