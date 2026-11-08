import { useRef, useState, type KeyboardEvent } from 'react';
import { nextTabIndex } from '../../model/tabs';
import { GALLERY_IMAGES } from './productosContent';

/** Nombre accesible del enlace a la imagen a tamaño completo. */
export const fullSizeLabel = (title: string) => `Abrir ${title.replace(/\.$/, '').toLowerCase()} a tamaño completo`;

/**
 * Panel «Imágenes» de la galería (galeria-imagenes.js): imagen principal con título,
 * descripción y contador, y siete miniaturas que se recorren con flechas, Inicio y Fin.
 */
export function GalleryImages({ hidden }: { hidden: boolean }) {
  const [selected, setSelected] = useState(0);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const image = GALLERY_IMAGES[selected];
  const total = GALLERY_IMAGES.length;

  const show = (index: number, focus = false) => {
    const next = (index + total) % total;
    setSelected(next);
    if (focus) thumbs.current[next]?.focus({ preventScroll: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(event.key, index, total);
    if (next === undefined) return;
    event.preventDefault();
    show(next, true);
  };

  return (
    <div id="gallery-images" className="gallery-panel" role="tabpanel" aria-labelledby="gallery-tab-images" tabIndex={0} hidden={hidden}>
      <figure className="listing-gallery">
        <a className="listing-image-link" href={image.src} target="_blank" rel="noopener" aria-label={fullSizeLabel(image.title)}>
          <img className="listing-image" id="listing-main-image" src={image.src} width={image.size} height={selected === 0 ? 1266 : image.size} alt={image.alt} loading="lazy" decoding="async" />
        </a>
        <figcaption className="listing-meta" aria-live="polite" aria-atomic="true">
          <div><strong data-listing-title>{image.title}</strong><p data-listing-description>{image.description}</p></div>
          <span className="listing-count" data-listing-count>{selected + 1} / {total}</span>
        </figcaption>
        <div className="listing-thumbnails" role="group" aria-label="Las siete imágenes del producto">
          {GALLERY_IMAGES.map((item, index) => (
            <button
              key={item.src}
              ref={node => { thumbs.current[index] = node; }}
              type="button"
              className="listing-thumb"
              aria-pressed={index === selected}
              aria-controls="listing-main-image"
              aria-label={`Imagen ${index + 1} de ${total}: ${item.label}`}
              onClick={() => show(index)}
              onKeyDown={event => onKeyDown(event, index)}
            >
              <img src={item.thumb} width={item.thumbWidth} height={item.thumbHeight} alt="" loading="lazy" /><span>{item.short}</span>
            </button>
          ))}
        </div>
      </figure>
    </div>
  );
}
