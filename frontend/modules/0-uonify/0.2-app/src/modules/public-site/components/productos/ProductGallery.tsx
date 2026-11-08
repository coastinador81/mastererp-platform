import { useCallback, useRef } from 'react';
import { useRovingTabs } from '../../hooks/useRovingTabs';
import { GalleryAplus } from './GalleryAplus';
import { GalleryImages } from './GalleryImages';
import { GalleryModel } from './GalleryModel';
import { GalleryVideo } from './GalleryVideo';

type GalleryTab = 'images' | 'model' | 'aplus' | 'video';
const TABS: readonly GalleryTab[] = ['images', 'model', 'aplus', 'video'];

/**
 * 02 / MUESTRA: galería del producto con Imágenes, Recursos 3D, Contenido A+ y Vídeo
 * (juego-uonify.js). Al salir de «Vídeo» se pausa la reproducción.
 */
export function ProductGallery() {
  const video = useRef<HTMLVideoElement>(null);
  const onSelect = useCallback((tab: GalleryTab) => { if (tab !== 'video') video.current?.pause?.(); }, []);
  const { selected, tabProps } = useRovingTabs(TABS, 'images', onSelect);
  return (
    <article className="visual-story product-gallery" id="contenido-visual" aria-labelledby="gallery-title">
      <div className="gallery-heading">
        <div><span className="story-number">02 / MUESTRA · GALERÍA DEL PRODUCTO</span><h3 id="gallery-title">Haz que se vea{' '}<br />tan bien como es.</h3></div>
        <p>Una imagen que atrae. Un detalle que puedes explorar. Una historia que ayuda a entenderlo.</p>
      </div>
      <div className="gallery-tabs" role="tablist" aria-label="Explorar la galería del producto">
        <button type="button" id="gallery-tab-images" data-gallery-tab="images" aria-controls="gallery-images" {...tabProps('images')}>Imágenes</button>
        <button type="button" id="gallery-tab-model" data-gallery-tab="model" aria-controls="gallery-model" {...tabProps('model')}>Recursos 3D <span aria-hidden="true">360°</span></button>
        <button type="button" id="gallery-tab-aplus" data-gallery-tab="aplus" aria-controls="gallery-aplus" {...tabProps('aplus')}>Contenido A+</button>
        <button type="button" id="gallery-tab-video" data-gallery-tab="video" aria-controls="gallery-video" {...tabProps('video')}>Vídeo</button>
      </div>
      <GalleryImages hidden={selected !== 'images'} />
      <GalleryModel active={selected === 'model'} />
      <GalleryAplus hidden={selected !== 'aplus'} />
      <GalleryVideo ref={video} hidden={selected !== 'video'} />
    </article>
  );
}
