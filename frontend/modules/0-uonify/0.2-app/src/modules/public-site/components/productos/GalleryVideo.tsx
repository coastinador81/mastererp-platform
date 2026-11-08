import { forwardRef } from 'react';

/** Panel «Vídeo»: el juego de Uonify cobra vida. */
export const GalleryVideo = forwardRef<HTMLVideoElement, { hidden: boolean }>(function GalleryVideo({ hidden }, ref) {
  return (
    <div id="gallery-video" className="gallery-panel" role="tabpanel" aria-labelledby="gallery-tab-video" tabIndex={0} hidden={hidden}>
      <figure className="product-video-stage">
        <video ref={ref} id="uonify-product-video" controls playsInline preload="metadata" poster="/assets/video-uonify-v63/poster-apertura.png" aria-label="Vídeo del juego de piezas de Uonify">
          <source src="/assets/video-uonify-v63/uonify-juego-propuesta-v63.mp4" type="video/mp4" />
          Tu navegador no puede reproducir este vídeo.
        </video>
        <figcaption>El juego de Uonify cobra vida.</figcaption>
      </figure>
    </div>
  );
});
