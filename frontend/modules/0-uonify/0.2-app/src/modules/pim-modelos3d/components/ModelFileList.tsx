import { useId } from 'react';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { fileNameOf, mb2 } from '../model/format';
import { isFileSelected } from '../model/state';
import type { Model3DFile, Model3DState } from '../model/types';

export interface ModelFileListProps {
  state: Model3DState;
  files: Model3DFile[];
  isLoading: boolean;
  refresh: () => void;
  deleteAll: () => Promise<void>;
  selectFile: (file: Model3DFile) => void;
  deleteFile: (file: Model3DFile) => Promise<void>;
}

/**
 * «Imágenes Generadas (n)»: los .glb no tienen vista previa, así que son filas
 * compactas (icono, nombre en mono, tamaño y papelera fantasma); el archivo
 * abierto en el visor lleva la selección azul.
 */
export function ModelFileList({ state, files, isLoading, refresh, deleteAll, selectFile, deleteFile }: ModelFileListProps) {
  const titleId = useId();
  return (
    <section className="pim-section" aria-labelledby={titleId}>
      <div className="pim-section-head">
        <h3 className="pim-section-title" id={titleId}>Imágenes Generadas ({files.length})</h3>
        <div className="pim-section-actions">
          <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" disabled={isLoading} onClick={refresh}>
            <Icon name="refresh-cw" size={14} className={isLoading ? 'pim-spin' : undefined} /> Actualizar
          </button>
          <button type="button" className="pim-btn pim-btn-danger pim-btn-sm" disabled={isLoading} onClick={() => void deleteAll()}>
            <Icon name="m3d-trash-2" size={14} /> Eliminar todos
          </button>
        </div>
      </div>
      <ul className="pim-modelos3d-files">
        {files.map(file => {
          const name = fileNameOf(file.key);
          return (
            <li key={file.key} className={clsx('pim-modelos3d-file', isFileSelected(file, state) && 'is-selected')}>
              <button type="button" className="pim-modelos3d-file-select" onClick={() => selectFile(file)}>
                <span className="pim-modelos3d-file-icon" aria-hidden="true"><Icon name="image" size={16} /></span>
                <span className="pim-modelos3d-file-meta">
                  <span className="pim-modelos3d-file-name">{name}</span>
                  <span className="pim-modelos3d-file-size">{mb2(file.size)}</span>
                </span>
              </button>
              <span className="pim-toolbar pim-modelos3d-file-actions">
                <button
                  type="button"
                  className="pim-btn pim-btn-ghost pim-btn-icon pim-modelos3d-btn-remove"
                  data-tooltip="Eliminar"
                  data-tooltip-align="end"
                  aria-label={`Eliminar ${name}`}
                  onClick={event => {
                    event.stopPropagation();
                    void deleteFile(file);
                  }}
                >
                  <Icon name="m3d-trash-2" size={16} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
