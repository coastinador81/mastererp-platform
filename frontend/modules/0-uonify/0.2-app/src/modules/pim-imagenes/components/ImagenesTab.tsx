import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useLatest } from '@/shared/hooks';
import { usePimScope, useTabContext } from '@/shared/pim';
import { handleDownloadImage } from '../actions/download';
import {
  clearProcessedImages,
  deleteSelectedImages,
  findImage,
  selectAllImages,
  toggleImageSelection,
} from '../actions/gallery';
import { mountImages } from '../actions/mount';
import { processSelectedImages } from '../actions/process';
import { useFocusKeeper } from '../hooks/useFocusKeeper';
import { useImagesMemory } from '../hooks/useImagesMemory';
import { useImagesSnapshot } from '../hooks/useImagesSnapshot';
import { headTotal } from '../model/lists';
import type { ImageItem } from '../model/types';
import '../styles/imagenes.css';
import '../styles/preview.css';
import { AiSection, GallerySection, ProcessedSection } from './GallerySection';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { ScraperSource } from './ScraperSource';
import { UploadSource } from './UploadSource';

/**
 * Pestaña «Imágenes» de la ficha (prototipo: pim/imagenes.js). Anatomía:
 * cabecera «Media» → Subir y Extraer desde URL lado a lado (con «Generar
 * Imágenes» debajo) → Galería → Procesadas → IA. Secciones planas separadas por
 * espacio y una línea fina; sin botón sólido en la vista principal.
 */
export function ImagenesTab() {
  const { key, product } = useTabContext();
  const scope = usePimScope();
  const snap = useImagesSnapshot(key, product);
  const busy = useImagesMemory(state => state.isProcessingImages);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const latestProduct = useLatest(product);

  // Montaje del prototipo: una vez por producto, antes de pintar.
  useLayoutEffect(() => {
    mountImages(scope, latestProduct.current);
  }, [scope, latestProduct]);

  useFocusKeeper(rootRef, '[data-focus="select-all"], [data-focus="generate"]');

  const openPreview = useCallback((image: ImageItem) => {
    if (findImage(scope, image.id)) setPreviewId(current => current ?? image.id);
  }, [scope]);
  const download = useCallback((image: ImageItem) => void handleDownloadImage(image), []);

  return (
    <div ref={rootRef} className="pim-imagenes" tabIndex={-1}>
      <div className="pim-head pim-imagenes-head" data-region="head">
        <div className="pim-head-row">
          <h2 className="pim-imagenes-title">Media</h2>
          <span className="pim-badge pim-imagenes-total">{headTotal(snap)} imágenes</span>
        </div>
      </div>
      <div className="pim-section pim-imagenes-sources">
        <UploadSource scope={scope} />
        <ScraperSource scope={scope} product={product} />
      </div>
      <GallerySection
        snap={snap}
        busy={busy}
        onPreview={openPreview}
        onSelectAll={() => selectAllImages(scope)}
        onToggle={id => toggleImageSelection(scope, id)}
        onDelete={() => deleteSelectedImages(scope, Boolean(product))}
        onClear={() => clearProcessedImages(scope)}
        onProcess={() => void processSelectedImages(scope)}
      />
      <ProcessedSection images={snap.lists.processed} onPreview={openPreview} onDownload={download} />
      <AiSection images={snap.lists.ai} onPreview={openPreview} onDownload={download} />
      {previewId ? <ImagePreviewDialog all={snap.all} startId={previewId} onClose={() => setPreviewId(null)} /> : null}
    </div>
  );
}
