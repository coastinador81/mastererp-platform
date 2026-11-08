import { useEffect, useRef, useState } from 'react';
import { loadModelViewer, ModelViewer, setMinimumRenderScale, type ModelViewerElement } from '../common/ModelViewer';

const PACKAGING_MODEL = '/assets/packaging-uonify-v56/packaging-refined.glb';
const POSTER = '/assets/packaging-uonify-v56/packaging-refined-front.png';

export const VIEWER_MESSAGES = {
  idle: 'La vista 3D se cargará al abrir esta pestaña.',
  loading: 'Cargando la caja en alta definición…',
  ready: 'Arrastra para girar 360°. Pellizca o usa la rueda para acercar. También puedes usar las flechas al enfocar el modelo.',
  loadFailed: 'No se pudo abrir el visor 3D. Puedes ver la caja en la imagen y volver a intentarlo al entrar en esta pestaña.',
  unavailable: 'El visor 3D no está disponible en este momento. La imagen conserva la vista de la caja.',
} as const;

/** Encuadre inicial de la caja (también el de «Restablecer vista»). */
const INITIAL_VIEW = { cameraOrbit: '25deg 73deg 74%', cameraTarget: 'auto auto auto', fieldOfView: '30deg' } as const;

/**
 * Panel «Recursos 3D 360°» (juego-uonify.js): el visor se descarga solo al abrir la
 * pestaña; si falla, queda la imagen del póster y se reintenta al volver a entrar.
 */
export function GalleryModel({ active }: { active: boolean }) {
  const viewer = useRef<ModelViewerElement>(null);
  const started = useRef(false);
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string>(VIEWER_MESSAGES.idle);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    setStatus(VIEWER_MESSAGES.loading);
    loadModelViewer()
      .then(() => { setMinimumRenderScale(1); setSrc(PACKAGING_MODEL); })
      .catch(() => { started.current = false; setStatus(VIEWER_MESSAGES.loadFailed); });
  }, [active]);

  useEffect(() => {
    const node = viewer.current;
    if (!node) return undefined;
    const onLoad = () => { setReady(true); setStatus(VIEWER_MESSAGES.ready); };
    const onError = () => {
      started.current = false;
      setReady(false);
      setStatus(VIEWER_MESSAGES.unavailable);
      node.showPoster?.();
      setSrc(undefined);
    };
    node.addEventListener('load', onLoad);
    node.addEventListener('error', onError);
    return () => { node.removeEventListener('load', onLoad); node.removeEventListener('error', onError); };
  }, []);

  const reset = () => {
    const node = viewer.current;
    if (!node) return;
    node.cameraOrbit = INITIAL_VIEW.cameraOrbit;
    node.cameraTarget = INITIAL_VIEW.cameraTarget;
    node.fieldOfView = INITIAL_VIEW.fieldOfView;
  };

  return (
    <div id="gallery-model" className="gallery-panel" role="tabpanel" aria-labelledby="gallery-tab-model" tabIndex={0} hidden={!active}>
      <div className="game-viewer-shell">
        <ModelViewer
          ref={viewer}
          attributes={{
            id: 'game-viewer', 'data-model': 'packaging', src, poster: POSTER,
            alt: 'Caja cerrada del juego Uonify: frente, reverso y cuatro laterales. Arrastra para girar y usa la rueda o pellizca para acercar.',
            'camera-controls': '', 'touch-action': 'pan-y', 'camera-orbit': INITIAL_VIEW.cameraOrbit, 'camera-target': INITIAL_VIEW.cameraTarget,
            'min-camera-orbit': 'auto 0deg 35%', 'max-camera-orbit': 'auto 180deg 150%', 'field-of-view': INITIAL_VIEW.fieldOfView,
            'shadow-intensity': '0', 'environment-image': '/assets/packaging-uonify-v56/studio.hdr', 'tone-mapping': 'neutral',
            exposure: '1', 'interaction-prompt': 'none', loading: 'eager',
          }}
        >
          <img className="model-poster" slot="poster" src={POSTER} alt="Caja cerrada del juego Uonify, renderizada en Blender" width="2560" height="1920" />
        </ModelViewer>
        <span className="viewer-badge">LA CAJA · 360°</span>
      </div>
      <div className="viewer-toolbar">
        <p id="viewer-status" role="status">{status}</p>
        <button type="button" id="reset-game-view" disabled={!ready} onClick={reset}>Restablecer vista</button>
      </div>
    </div>
  );
}
