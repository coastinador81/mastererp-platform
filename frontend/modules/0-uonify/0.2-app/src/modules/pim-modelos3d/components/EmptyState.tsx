import { useEffect, useId, useRef } from 'react';
import { Icon } from '@/shared/ui';
import { generateDisabled, sourceMessage, type ImageSets } from '../model/images';
import type { ImageSource } from '../model/types';

export interface EmptyStateProps {
  imageSets: ImageSets;
  imageSource: ImageSource;
  customImages: File[];
  onSource: (source: ImageSource) => void;
  onCustomImages: (files: File[]) => void;
  onGenerate: () => void;
  onUpload: () => void;
}

/** Selector de archivos de «Subir Nuevas». E30: vuelve a mostrar los que se siguen usando. */
function CustomImagesInput({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input || !files.length || typeof DataTransfer === 'undefined') return;
    try {
      const transfer = new DataTransfer();
      files.forEach(file => transfer.items.add(file));
      input.files = transfer.files;
    } catch {
      /* el navegador no lo permite */
    }
    // Solo al montar el campo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <input
      ref={ref}
      type="file"
      multiple
      accept="image/*"
      className="pim-modelos3d-file-input"
      aria-label="Subir Nuevas"
      onChange={event => onChange(Array.from(event.target.files ?? []))}
    />
  );
}

/**
 * Estado vacío (E26): una sola superficie discontinua con la acción principal
 * sólida y, debajo, la fuente de imágenes como dos opciones seleccionables.
 */
export function EmptyState({ imageSets, imageSource, customImages, onSource, onCustomImages, onGenerate, onUpload }: EmptyStateProps) {
  const sourceId = useId();
  const { processed, all } = imageSets;
  const message = sourceMessage(imageSource, imageSets, customImages.length);
  const option = (source: ImageSource, icon: string, name: string, count: number) => (
    <button
      type="button"
      className="pim-option pim-modelos3d-source-opt"
      aria-pressed={imageSource === source}
      onClick={() => onSource(source)}
    >
      <Icon name={icon} size={20} />
      <span className="pim-modelos3d-source-name">{name}</span>
      <span className="pim-modelos3d-source-count">{count} imágenes</span>
    </button>
  );
  return (
    <section className="pim-card pim-card-dashed pim-modelos3d-empty">
      <div className="pim-empty">
        <Icon name="box" size={32} />
        <h3 className="pim-modelos3d-empty-title">Genera Modelos 3D con Uony</h3>
        <p className="pim-modelos3d-empty-text">Crea modelos 3D de alta calidad desde las imágenes de tu producto usando inteligencia artificial</p>
        <div className="pim-modelos3d-empty-actions">
          <button
            type="button"
            className="pim-btn pim-btn-primary"
            disabled={generateDisabled(imageSource, imageSets, customImages.length)}
            onClick={onGenerate}
          >
            <Icon name="uony" size={16} /> Generar Modelo 3D
          </button>
          <button type="button" className="pim-btn pim-btn-outline" onClick={onUpload}>
            <Icon name="upload" size={16} /> Subir Modelo
          </button>
        </div>
      </div>
      <div className="pim-modelos3d-source">
        <span className="pim-label" id={sourceId}>Fuente de Imágenes</span>
        <div className="pim-modelos3d-source-grid" role="group" aria-labelledby={sourceId}>
          {option('gallery', 'image', 'Galería', processed.length > 0 ? processed.length : all.length)}
          {option('upload', 'upload', 'Subir Nuevas', customImages.length)}
        </div>
        {imageSource === 'upload' ? <div><CustomImagesInput files={customImages} onChange={onCustomImages} /></div> : null}
        <div aria-live="polite">
          {message ? (
            <p className={`pim-modelos3d-msg is-${message.tone}`}>
              <Icon name={message.tone === 'warning' ? 'alert-triangle' : 'm3d-circle-check'} size={14} /> {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
