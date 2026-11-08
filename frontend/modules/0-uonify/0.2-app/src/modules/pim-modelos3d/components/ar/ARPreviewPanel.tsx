import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui';
import { GENERATED_MODEL } from '../../model/constants';
import { prefersReducedMotion } from '../../model/environment';
import { loadModelViewer } from '../../three/modelViewer';

const TECH_INFO: [string, string][] = [
  ['Polígonos', '~45,000'],
  ['Texturas', '2048x2048'],
  ['Formato', 'GLB/GLTF'],
  ['Tamaño', '~2.3 MB'],
];

/**
 * <model-viewer> con AR (webxr, Scene Viewer y Quick Look). El modelo simulado
 * 'generated' recibe el GLB del cubo (E52). «Cargando modelo 3D...» se oculta
 * al terminar la carga; sin <model-viewer> queda el indicador.
 */
function ModelViewerBox({ modelUrl, name }: { modelUrl: string; name: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let element: HTMLElement | null = null;
    const source = modelUrl === GENERATED_MODEL ? import('../../three').then(three => three.generatedModelURL()) : Promise.resolve(modelUrl);
    Promise.all([loadModelViewer(), source]).then(([, src]) => {
      const box = boxRef.current;
      if (cancelled || !box) return;
      element = document.createElement('model-viewer');
      element.className = 'pim-modelos3d-mv';
      element.setAttribute('alt', name);
      // Sin giro automático cuando la persona pide reducir el movimiento.
      if (!prefersReducedMotion()) element.setAttribute('auto-rotate', '');
      element.setAttribute('camera-controls', '');
      element.setAttribute('ar', '');
      element.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
      element.setAttribute('environment-image', 'neutral');
      element.setAttribute('shadow-intensity', '1');
      // Hueco vacío: el indicador propio sustituye la barra de progreso por defecto.
      const slot = document.createElement('div');
      slot.setAttribute('slot', 'progress-bar');
      element.appendChild(slot);
      element.addEventListener('load', () => setLoaded(true));
      element.setAttribute('src', src);
      box.appendChild(element);
    }, () => { /* sin model-viewer: queda el indicador */ });
    return () => {
      cancelled = true;
      element?.remove();
    };
  }, [modelUrl, name]);

  return (
    <div className="pim-modelos3d-mvbox" ref={boxRef}>
      <div className="pim-modelos3d-mvprogress" hidden={loaded}>
        <span className="pim-modelos3d-spinner is-large" aria-hidden="true" />
        <p>Cargando modelo 3D...</p>
      </div>
    </div>
  );
}

/** «Preview 3D»: vista previa de cómo se verá el producto en AR. */
export function ARPreviewPanel({ modelUrl, name }: { modelUrl: string; name: string }) {
  return (
    <section className="pim-modelos3d-group">
      <h3 className="pim-modelos3d-grouptitle"><Icon name="box" size={18} /> Preview de Producto</h3>
      <p className="pim-modelos3d-groupdesc">Vista previa de cómo se verá el producto en AR</p>
      {modelUrl ? (
        <div className="pim-modelos3d-dlg-stack">
          <ModelViewerBox modelUrl={modelUrl} name={name} />
          <div className="pim-modelos3d-centered"><span className="pim-badge pim-badge-green"><Icon name="check" size={12} /> Modelo Real Cargado</span></div>
        </div>
      ) : (
        <div className="pim-modelos3d-argrid2">
          <div className="pim-modelos3d-dlg-stack">
            <div className="pim-modelos3d-mvempty"><Icon name="box" size={32} /><p>No hay modelo 3D generado</p></div>
            <p className="pim-modelos3d-text pim-modelos3d-center-text">Genera un modelo 3D primero</p>
          </div>
          <div className="pim-modelos3d-dlg-stack">
            <div className="pim-modelos3d-mvempty is-slate"><Icon name="scan" size={32} /><p>Vista AR no disponible</p></div>
            <p className="pim-modelos3d-text pim-modelos3d-center-text">Esperando modelo 3D</p>
          </div>
        </div>
      )}
      <div className="pim-card pim-card-soft pim-modelos3d-techinfo">
        <h4 className="pim-modelos3d-subtitle"><Icon name="info" size={16} /> Información Técnica</h4>
        <dl>
          {TECH_INFO.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
        </dl>
      </div>
    </section>
  );
}
