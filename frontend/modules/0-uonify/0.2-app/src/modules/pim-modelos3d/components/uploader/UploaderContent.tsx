import { Icon } from '@/shared/ui';
import type { ValidationData } from '../../model/types';

export type ValidationStatus = 'idle' | 'validating' | 'success' | 'error';

export interface UploaderContentProps {
  status: ValidationStatus;
  isProcessing: boolean;
  progress: number;
  fileName: string;
  data: ValidationData | null;
  onPick: () => void;
  onRetry: () => void;
}

/** Contenido de la zona de «Cargar Modelo 3D» según el estado de la validación. */
export function UploaderContent({ status, isProcessing, progress, fileName, data, onPick, onRetry }: UploaderContentProps) {
  return (
    <>
      {status === 'idle' && !isProcessing ? (
        <div className="pim-modelos3d-centered">
          <span className="pim-modelos3d-statusicon"><Icon name="upload" size={28} /></span>
          <h4 className="pim-modelos3d-h4">Arrastra tu modelo 3D aquí</h4>
          <p className="pim-modelos3d-text">o haz clic para seleccionar un archivo</p>
          <button type="button" className="pim-btn pim-btn-outline" data-u="pick" data-autofocus onClick={onPick}>
            <Icon name="m3d-file-type" size={16} /> Seleccionar Archivo
          </button>
          <p className="pim-modelos3d-xs">GLB, glTF • Máx. 50MB • Con texturas PBR</p>
        </div>
      ) : null}
      {isProcessing ? (
        <div className="pim-modelos3d-centered">
          <span className="pim-modelos3d-statusicon"><Icon name="sparkles" size={28} className="pim-modelos3d-pulse" /></span>
          <h4 className="pim-modelos3d-h4">{status === 'validating' ? 'Analizando modelo...' : 'Procesando...'}</h4>
          <p className="pim-modelos3d-text pim-modelos3d-filename">{fileName}</p>
          <div className="pim-modelos3d-progress-wrap">
            <div className="pim-progress" role="progressbar" aria-label="Analizando modelo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className="pim-modelos3d-xs pim-modelos3d-count">{progress}%</p>
          </div>
        </div>
      ) : null}
      {status === 'success' && data ? (
        <div className="pim-modelos3d-centered">
          <span className="pim-modelos3d-statusicon is-success"><Icon name="m3d-circle-check" size={28} /></span>
          <h4 className="pim-modelos3d-h4">¡Modelo validado exitosamente!</h4>
          <p className="pim-modelos3d-text pim-modelos3d-filename">{fileName}</p>
          <div className="pim-modelos3d-stats">
            <div><span>Triángulos</span><strong>{data.triangles.toLocaleString()}</strong></div>
            <div><span>Texturas</span><strong className="pim-mono">{data.textureResolution}</strong></div>
            <div><span>Calidad</span><strong>{data.validationScore}%</strong></div>
          </div>
          <div className="pim-modelos3d-badges is-center">
            {data.hasTextures ? <span className="pim-badge pim-badge-green"><Icon name="image" size={12} /> Con Texturas</span> : null}
            {data.hasMaterials ? <span className="pim-badge pim-badge-green"><Icon name="layers" size={12} /> Con Materiales</span> : null}
          </div>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="pim-modelos3d-centered">
          <span className="pim-modelos3d-statusicon is-error"><Icon name="alert-circle" size={28} /></span>
          <h4 className="pim-modelos3d-h4">Error al validar modelo</h4>
          <p className="pim-modelos3d-text pim-modelos3d-filename">{fileName}</p>
          <button type="button" className="pim-btn pim-btn-outline" data-u="retry" onClick={onRetry}>Intentar de nuevo</button>
        </div>
      ) : null}
    </>
  );
}

/** Avisos y errores del análisis bajo la zona de subida. */
export function UploaderAlerts({ data }: { data: ValidationData | null }) {
  if (!data || (data.warnings.length === 0 && data.errors.length === 0)) return null;
  return (
    <>
      {data.errors.map(error => (
        <div className="pim-alert pim-alert-red" role="alert" key={`e-${error}`}><Icon name="alert-circle" size={16} /><span>{error}</span></div>
      ))}
      {data.warnings.map(warning => (
        <div className="pim-alert pim-alert-amber" key={`w-${warning}`}><Icon name="alert-circle" size={16} /><span>{warning}</span></div>
      ))}
    </>
  );
}
