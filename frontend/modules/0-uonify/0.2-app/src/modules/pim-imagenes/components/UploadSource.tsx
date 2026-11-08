import { useId, useState, type ChangeEvent, type DragEvent } from 'react';
import clsx from 'clsx';
import type { PimScope } from '@/shared/pim';
import { Icon } from '@/shared/ui';
import { processUploadedFiles } from '../actions/upload';
import { ACCEPT_IMAGES } from '../model/files';

/**
 * «Subir Imágenes» (prototipo: sección de subida de rootHTML). El campo de archivo
 * cubre toda la zona (transparente): clic en cualquier punto abre el selector y la
 * etiqueta «Seleccionar» le da nombre. También se puede soltar encima.
 */
export function UploadSource({ scope }: { scope: PimScope }) {
  const titleId = useId();
  const fileId = useId();
  const hintId = useId();
  const [isOver, setOver] = useState(false);

  const activate = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setOver(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) void processUploadedFiles(scope, Array.from(files));
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length) void processUploadedFiles(scope, files);
  };

  return (
    <section className="pim-imagenes-source" aria-labelledby={titleId}>
      <h3 id={titleId} className="pim-section-title">
        <Icon name="upload" size={16} />
        Subir Imágenes
      </h3>
      <div
        className={clsx('pim-dropzone pim-imagenes-drop', isOver && 'is-over')}
        data-dropzone
        onDragOver={activate}
        onDragEnter={activate}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          type="file"
          multiple
          accept={ACCEPT_IMAGES}
          id={fileId}
          className="pim-imagenes-file"
          data-focus="file"
          aria-describedby={hintId}
          onChange={onChange}
        />
        <Icon name="upload-cloud" size={24} />
        <p>Arrastra imágenes aquí</p>
        <label htmlFor={fileId} className="pim-btn pim-btn-outline pim-btn-sm pim-imagenes-select">
          <Icon name="upload" size={14} />
          Seleccionar
        </label>
        <p id={hintId} className="pim-hint">JPG, PNG, WEBP • Máx. 10MB</p>
      </div>
    </section>
  );
}
