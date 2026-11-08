import { useId } from 'react';
import { Icon } from '@/shared/ui';
import { galleryTotal } from '../model/lists';
import type { ImageItem, ImagesSnapshot } from '../model/types';
import { AiTile, GalleryTile, ProcessedTile, type TileHandlers } from './ImageTiles';

/**
 * Secciones planas de la galería, las procesadas y las de IA (prototipo:
 * galleryHTML, processedHTML y aiHTML): cabecera con el título a la izquierda y
 * las acciones a la derecha, y la rejilla debajo. Sin imágenes no se pintan.
 */

/** Claves de React estables (el id) sin repetir aunque dos imágenes compartan id. */
function uniqueKeys(): (id: string) => string {
  const seen = new Map<string, number>();
  return id => {
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    return count ? `${id}#${count}` : id;
  };
}

export interface GalleryActions {
  onSelectAll: () => void;
  onToggle: (id: string) => void;
  onDelete: () => void;
  onClear: () => void;
  onProcess: () => void;
}

export function GallerySection({ snap, busy, onPreview, ...actions }: {
  snap: ImagesSnapshot;
  busy: boolean;
  onPreview: (image: ImageItem) => void;
} & GalleryActions) {
  const titleId = useId();
  const { lists, derived, all, selection } = snap;
  if (all.length === 0) return null;
  const amazon = [...derived.amazonImages, ...derived.productImages];
  const total = galleryTotal(snap);
  const none = selection.length === 0;
  const keyOf = uniqueKeys();
  const tile = (image: ImageItem, kind: 'upload' | 'scrape' | 'amazon') => (
    <GalleryTile
      key={keyOf(image.id)}
      image={image}
      kind={kind}
      selected={selection.includes(image.id)}
      onToggle={actions.onToggle}
      onPreview={onPreview}
    />
  );
  return (
    <section className="pim-section" data-region="gallery" aria-labelledby={titleId}>
      <div className="pim-section-head">
        <h3 id={titleId} className="pim-section-title">
          <Icon name="image" size={16} />
          Galería de Imágenes ({total})
        </h3>
        <div className="pim-section-actions pim-imagenes-toolbar">
          <button type="button" className="pim-btn pim-btn-ghost pim-btn-sm" data-focus="select-all" disabled={all.length === 0} onClick={actions.onSelectAll}>
            <Icon name="check-circle-2" size={14} />
            Todas
          </button>
          <button type="button" className="pim-btn pim-btn-ghost pim-btn-sm pim-imagenes-btn-destructive" data-focus="delete-selected" disabled={none} onClick={actions.onDelete}>
            <Icon name="trash" size={14} />
            Eliminar
          </button>
          <button type="button" className="pim-btn pim-btn-ghost pim-btn-sm pim-imagenes-btn-destructive" data-focus="clear-processed" onClick={actions.onClear}>
            <Icon name="trash" size={14} />
            Vaciar
          </button>
          <button
            type="button"
            className="pim-btn pim-btn-outline pim-btn-sm"
            data-focus="process"
            disabled={none || busy}
            aria-busy={busy || undefined}
            onClick={actions.onProcess}
          >
            {busy ? <Icon name="refresh-cw" size={14} className="pim-spin" /> : <Icon name="maximize-2" size={14} />}
            Redimensionar
          </button>
        </div>
      </div>
      {total ? (
        <ul className="pim-imagenes-grid" role="list">
          {lists.uploaded.map(image => tile(image, 'upload'))}
          {lists.scraped.map(image => tile(image, 'scrape'))}
          {amazon.map(image => tile(image, 'amazon'))}
        </ul>
      ) : null}
    </section>
  );
}

export function ProcessedSection({ images, ...handlers }: { images: ImageItem[] } & TileHandlers) {
  const titleId = useId();
  if (!images.length) return null;
  const keyOf = uniqueKeys();
  return (
    <section className="pim-section" data-region="processed" aria-labelledby={titleId}>
      <div className="pim-section-head">
        <h3 id={titleId} className="pim-section-title">
          <Icon name="check-circle-2" size={16} />
          Imágenes Procesadas ({images.length})
        </h3>
      </div>
      <ul className="pim-imagenes-grid" role="list">
        {images.map(image => <ProcessedTile key={keyOf(image.id)} image={image} {...handlers} />)}
      </ul>
    </section>
  );
}

export function AiSection({ images, ...handlers }: { images: ImageItem[] } & TileHandlers) {
  const titleId = useId();
  if (!images.length) return null;
  const keyOf = uniqueKeys();
  return (
    <section className="pim-section" data-region="ai" aria-labelledby={titleId}>
      <div className="pim-section-head">
        <h3 id={titleId} className="pim-section-title">
          Imágenes IA Generadas ({images.length})
          <span className="pim-ai-mark" aria-hidden="true"><Icon name="sparkles" size={12} /></span>
        </h3>
      </div>
      <ul className="pim-imagenes-grid" role="list">
        {images.map(image => <AiTile key={keyOf(image.id)} image={image} {...handlers} />)}
      </ul>
    </section>
  );
}
