import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLatest } from '@/shared/hooks';
import { Dialog, Icon } from '@/shared/ui';
import { handleDownloadImage } from '../actions/download';
import { navigateIndex } from '../model/files';
import type { ImageItem } from '../model/types';
import { PreviewDetails } from './PreviewDetails';

/**
 * «Vista Previa de Imagen» (prototipo: openImagePreview, renderPreview y el
 * teclado de pim/imagenes.js). Visor ancho (95vw), flechas sobre la imagen y
 * ← / → del teclado para recorrer toda la galería. Cualquier forma de cerrar
 * (X, Escape, clic fuera, «Cerrar vista previa») lo reinicia igual.
 *
 * Se pinta en <body> (portal) para no heredar la tipografía de la pestaña; el
 * portal conserva el contexto de React.
 */

interface PreviewState {
  image: ImageItem | null;
  index: number;
  /** La animación de entrada solo al abrir (no al navegar). */
  entering: boolean;
}

export function ImagePreviewDialog({ all, startId, onClose }: { all: ImageItem[]; startId: string; onClose: () => void }) {
  const [state, setState] = useState<PreviewState>(() => {
    const index = all.findIndex(img => img.id === startId);
    return { image: index >= 0 ? all[index] : null, index: Math.max(index, 0), entering: true };
  });
  const latest = useLatest({ all });

  const navigate = (direction: 'prev' | 'next') => {
    const images = latest.current.all;
    if (images.length === 0) return;
    setState(current => {
      const index = navigateIndex(current.index, images.length, direction);
      return { image: images[index] ?? null, index, entering: false };
    });
  };
  const latestNavigate = useLatest(navigate);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        latestNavigate.current('prev');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        latestNavigate.current('next');
      }
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [latestNavigate]);

  const { image, index, entering } = state;
  const dialog = (
    <Dialog
      open
      onClose={onClose}
      title="Vista Previa de Imagen"
      description="Visualiza la imagen y navega por la galería usando las flechas del teclado o los botones de navegación."
      size="xl"
      className="pim-imagenes-preview-dialog"
    >
      <div className="pim-imagenes-viewer" tabIndex={-1}>
        <div className="pim-imagenes-stage">
          {image ? (
            <>
              <img className="pim-imagenes-stage-img" src={image.url} alt={image.name || ''} />
              <button
                type="button"
                className="pim-btn pim-btn-outline pim-btn-icon pim-imagenes-nav pim-imagenes-nav-prev"
                data-focus="nav-prev"
                aria-label="Imagen anterior"
                data-tooltip="Imagen anterior"
                data-tooltip-align="start"
                onClick={() => navigate('prev')}
              >
                <Icon name="chevron-left" size={18} />
              </button>
              <button
                type="button"
                className="pim-btn pim-btn-outline pim-btn-icon pim-imagenes-nav pim-imagenes-nav-next"
                data-focus="nav-next"
                aria-label="Siguiente imagen"
                data-tooltip="Siguiente imagen"
                data-tooltip-align="end"
                onClick={() => navigate('next')}
              >
                <Icon name="chevron-right" size={18} />
              </button>
            </>
          ) : (
            <div className="pim-empty pim-imagenes-notfound">
              <Icon name="image" size={40} />
              <strong>Imagen no encontrada</strong>
            </div>
          )}
        </div>
        <div className="pim-imagenes-details">
          {image ? (
            <PreviewDetails
              image={image}
              index={index}
              count={all.length}
              entering={entering}
              onDownload={() => void handleDownloadImage(image)}
              onClose={onClose}
            />
          ) : null}
        </div>
      </div>
    </Dialog>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
