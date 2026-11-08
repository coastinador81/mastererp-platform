import { useId } from 'react';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';

export interface ViewerPlaceholderProps {
  showGrid: boolean;
  autoRotate: boolean;
  loaded: boolean;
  /** Canvas activos si el visor está en pausa por el límite de 3; si no, null. */
  pausedCount: number | null;
}

/**
 * Model3DPlaceholder: cubo en azul de marca sobre escena neutra mientras se
 * prepara el canvas (textos en inglés del original, marcados con lang="en").
 */
export function ViewerPlaceholder({ showGrid, autoRotate, loaded, pausedCount }: ViewerPlaceholderProps) {
  // Id sin signos: se usa dentro de url(#…).
  const patternId = `m3d${useId().replace(/[^\w-]/g, '')}-grid`;
  return (
    <div className="pim-modelos3d-ph" lang="en">
      {showGrid ? (
        <svg className="pim-modelos3d-ph-grid" aria-hidden="true">
          <defs>
            <pattern id={patternId} width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </svg>
      ) : null}
      <div className="pim-modelos3d-ph-center">
        <div className={clsx('pim-modelos3d-ph-cube', loaded && 'is-loaded')} aria-hidden="true">
          <div className={clsx('pim-modelos3d-ph-body', autoRotate && 'is-rotating')}>
            <div className="pim-modelos3d-ph-face"><span /><i /><b /></div>
            <div className="pim-modelos3d-ph-wire" />
            <div className="pim-modelos3d-ph-wire2" />
          </div>
        </div>
        <h3>{loaded ? '3D Model Viewer' : 'Loading 3D Model...'}</h3>
        <div className="pim-modelos3d-ph-badges">
          <span className="pim-badge pim-badge-outline"><Icon name="box" size={10} /> WebGL Ready</span>
          {showGrid ? <span className="pim-badge pim-badge-outline">Grid Enabled</span> : null}
          {autoRotate ? <span className="pim-badge pim-badge-outline">Auto Rotate</span> : null}
        </div>
        {loaded ? null : <span className="pim-modelos3d-spinner" aria-hidden="true" />}
      </div>
      {pausedCount !== null ? (
        <div className="pim-modelos3d-ph-strip" lang="es">
          <i className="pim-modelos3d-dot is-warning pim-modelos3d-pulse" aria-hidden="true" />
          <span>Visor 3D en pausa - {pausedCount} canvas activos</span>
        </div>
      ) : null}
    </div>
  );
}
