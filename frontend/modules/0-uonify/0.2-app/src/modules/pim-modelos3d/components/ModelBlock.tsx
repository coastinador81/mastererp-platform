import clsx from 'clsx';
import { Icon, Progress } from '@/shared/ui';
import { selectedMetadata } from '../model/state';
import type { Model3DFile, Model3DMetadata, Model3DState, QualityInfo } from '../model/types';
import { Model3DViewer } from './viewer/Model3DViewer';

export interface ModelBlockProps {
  state: Model3DState;
  files: Model3DFile[];
  onQualityInfo: (info: QualityInfo) => void;
  onDownload: () => void;
  onAR: () => void;
  onDelete: () => void;
  onCancelGeneration: () => void;
}

/** Tarjetas Polígonos / Texturas / Formato / Tamaño del archivo abierto (E21). */
function ModelMetadataStats({ metadata }: { metadata: Model3DMetadata }) {
  return (
    <dl className="pim-modelos3d-stats pim-modelos3d-meta">
      <div>
        <dt><Icon name="grid" size={14} /> Polígonos</dt>
        <dd>~{(Number(metadata.polygons) / 1000).toFixed(1)}k</dd>
        <dd className="pim-modelos3d-metasub">estimados</dd>
      </div>
      <div>
        <dt><Icon name="image" size={14} /> Texturas</dt>
        <dd className="pim-mono">{String(metadata.texture_resolution ?? '')}</dd>
        <dd className="pim-modelos3d-metasub">resolución</dd>
      </div>
      <div>
        <dt><Icon name="layers" size={14} /> Formato</dt>
        <dd className="pim-mono">{String(metadata.format ?? '')}</dd>
        <dd className="pim-modelos3d-metasub">{String(metadata.compression ?? '')}</dd>
      </div>
      <div>
        <dt><Icon name="download" size={14} /> Tamaño</dt>
        <dd>~{(Number(metadata.file_size) / 1024 / 1024).toFixed(1)} MB</dd>
        <dd className="pim-modelos3d-metasub">archivo</dd>
      </div>
    </dl>
  );
}

/** «Generando Modelo 3D con Uony» con su «Cancelar» (E22). */
function GenerationProgress({ progress, onCancel }: { progress: number; onCancel: () => void }) {
  const value = Number(progress) || 0;
  return (
    <section className="pim-card pim-modelos3d-gen">
      <div className="pim-modelos3d-gen-row">
        <span className="pim-modelos3d-statusicon is-ai"><Icon name="uony" size={16} className="pim-modelos3d-pulse" /></span>
        <div className="pim-modelos3d-grow">
          <h4 className="pim-modelos3d-subtitle">Generando Modelo 3D con Uony</h4>
          <p className="pim-modelos3d-text">Procesando imágenes y creando geometría...</p>
        </div>
        <span className="pim-badge pim-badge-ai pim-modelos3d-count" aria-live="polite">{value}%</span>
        <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" onClick={onCancel}>Cancelar</button>
      </div>
      <Progress ai value={value} label="Generando Modelo 3D con Uony" />
    </section>
  );
}

/**
 * Bloque del modelo (E09): visor, metadatos, progreso de la generación y
 * acciones. «Descargar GLB» es la acción sólida solo con un modelo abierto.
 */
export function ModelBlock({ state, files, onQualityInfo, onDownload, onAR, onDelete, onCancelGeneration }: ModelBlockProps) {
  const metadata = selectedMetadata(files, state);
  const selected = state.selected3DModel;
  return (
    <section className="pim-modelos3d-block">
      {selected ? (
        <div className="pim-modelos3d-viewer-slot">
          <Model3DViewer modelUrl={selected} category={state.model3DCategory} onQualityInfo={onQualityInfo} />
        </div>
      ) : null}
      {metadata ? <ModelMetadataStats metadata={metadata} /> : null}
      {state.isGenerating3D ? <GenerationProgress progress={state.generation3DProgress} onCancel={onCancelGeneration} /> : null}
      <div className="pim-modelos3d-actions">
        <div className="pim-modelos3d-actions-main">
          <button
            type="button"
            className={clsx('pim-btn', selected ? 'pim-btn-primary' : 'pim-btn-outline')}
            data-m3d-action="download"
            onClick={onDownload}
          >
            <Icon name="download" size={16} /> Descargar GLB
          </button>
          <button type="button" className="pim-btn pim-btn-outline" onClick={onAR}>
            <Icon name="eye" size={16} /> Vista AR
          </button>
        </div>
        <button
          type="button"
          className="pim-btn pim-btn-ghost pim-btn-icon pim-modelos3d-btn-remove"
          data-tooltip="Eliminar modelo 3D"
          data-tooltip-align="end"
          aria-label="Eliminar modelo 3D"
          onClick={onDelete}
        >
          <Icon name="m3d-trash-2" size={16} />
        </button>
      </div>
    </section>
  );
}
