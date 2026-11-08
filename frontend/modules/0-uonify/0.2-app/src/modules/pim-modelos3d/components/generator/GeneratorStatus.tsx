import clsx from 'clsx';
import { Icon, Progress } from '@/shared/ui';
import { cap, fileNameOf, mb2 } from '../../model/format';
import type { GeneratorConfig, Model3DFile } from '../../model/types';

/** «Procesamiento en Curso» (E44): la subida tiene un upload_id y aún no hay resultados. */
export function ProcessingState({ uploadId, isLoading, onCheck }: { uploadId: string; isLoading: boolean; onCheck: () => void }) {
  return (
    <section className="pim-modelos3d-state">
      <span className="pim-modelos3d-statusicon is-ai"><Icon name="sparkles" size={28} /></span>
      <h4 className="pim-modelos3d-h4">Procesamiento en Curso</h4>
      <p className="pim-modelos3d-text">Tu modelo se está generando. Esto puede tomar entre 5-15 minutos dependiendo de la cantidad de imágenes.</p>
      <div className="pim-modelos3d-idbox">
        <span className="pim-modelos3d-xs">ID de Procesamiento</span>
        <code>{uploadId}</code>
      </div>
      <button type="button" className="pim-btn pim-btn-primary" disabled={isLoading} onClick={onCheck}>
        {isLoading
          ? <><Icon name="sparkles" size={16} className="pim-spin" /> Consultando...</>
          : <><Icon name="m3d-circle-check" size={16} /> Consultar Resultados</>}
      </button>
    </section>
  );
}

export interface GeneratedResultsProps {
  files: Model3DFile[];
  selected: string | null;
  onPick: (file: Model3DFile) => void;
  onUse: () => void;
}

/** Resultados del servidor (E45): elegir un archivo y «Usar Modelo Seleccionado». */
export function GeneratedResults({ files, selected, onPick, onUse }: GeneratedResultsProps) {
  return (
    <section className="pim-modelos3d-group">
      <div>
        <h4 className="pim-modelos3d-subtitle">Imágenes Generadas ({files.length})</h4>
        <p className="pim-modelos3d-text">Selecciona la imagen que deseas usar en A+ Content</p>
      </div>
      <div className="pim-modelos3d-gfiles">
        {files.map(file => {
          const isSelected = selected === file.key;
          return (
            <button
              type="button"
              key={file.key}
              className={clsx('pim-option pim-modelos3d-gfile', isSelected && 'is-selected')}
              aria-pressed={isSelected}
              onClick={() => onPick(file)}
            >
              <span className="pim-modelos3d-file-icon" aria-hidden="true"><Icon name="image" size={16} /></span>
              <span className="pim-modelos3d-file-meta">
                <span className="pim-modelos3d-file-name">{fileNameOf(file.key)}</span>
                <span className="pim-modelos3d-file-size">{mb2(file.size)}</span>
              </span>
              {isSelected ? <span className="pim-modelos3d-gcheck" aria-hidden="true"><Icon name="check" size={14} /></span> : null}
            </button>
          );
        })}
      </div>
      {selected ? (
        <button type="button" className="pim-btn pim-btn-primary pim-modelos3d-use" onClick={onUse}>
          <Icon name="m3d-circle-check" size={16} /> Usar Modelo Seleccionado
        </button>
      ) : null}
    </section>
  );
}

/** Generación en curso (E39-E43): el paso actual como título y el progreso de IA. */
export function GenerationRun({ step, progress, config }: { step: string; progress: number; config: GeneratorConfig }) {
  return (
    <section className="pim-modelos3d-run" aria-live="polite">
      <div className="pim-modelos3d-run-head">
        <span className="pim-modelos3d-statusicon is-ai"><Icon name="sparkles" size={20} className="pim-modelos3d-pulse" /></span>
        <div className="pim-modelos3d-grow">
          <h4 className="pim-modelos3d-h4">{step}</h4>
          <p className="pim-modelos3d-text">Por favor espera mientras generamos tu modelo 3D</p>
        </div>
      </div>
      <div className="pim-modelos3d-progress-row">
        <div className="pim-modelos3d-between">
          <span className="pim-modelos3d-xs">Progreso</span>
          <span className="pim-badge pim-badge-ai pim-modelos3d-count">{progress}%</span>
        </div>
        <Progress ai value={progress} label="Progreso" />
      </div>
      <div className="pim-modelos3d-stats">
        <div><span>Calidad</span><strong>{cap(config.quality)}</strong></div>
        <div><span>Detalle</span><strong>{cap(config.polyCount)}</strong></div>
        <div><span>Texturas</span><strong className="pim-mono">{config.textureResolution}px</strong></div>
      </div>
    </section>
  );
}
