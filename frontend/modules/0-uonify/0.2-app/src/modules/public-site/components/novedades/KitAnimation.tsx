import { useEffect, useRef, useState } from 'react';
import { useLatest, useMediaQuery } from '@/shared/hooks';
import { loadModelViewer, ModelViewer, type ModelViewerElement } from '../common/ModelViewer';
import { createKitController, type KitController, type KitUi } from './kitController';

const KIT_MODEL = '/assets/jenga/conjunto-torre-v62.glb';
const KIT_POSTER = '/assets/jenga/conjunto.webp';

/**
 * Animación del juego de piezas de Novedades: los tres personajes se reúnen en una
 * torre y vuelven a formarse. Controles de postura y reproducción cuando el modelo
 * carga; si no, queda la imagen del conjunto.
 */
export function KitAnimation() {
  const viewer = useRef<ModelViewerElement>(null);
  const controller = useRef<KitController | null>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const reducedRef = useLatest(reduced);
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [ui, setUi] = useState<KitUi>({ loaded: false, playing: false, pose: 'assembled', status: '' });

  useEffect(() => {
    const node = viewer.current;
    if (!node) return undefined;
    const control = createKitController(node, {
      reduced: () => reducedRef.current,
      onChange: patch => setUi(current => ({ ...current, ...patch })),
    });
    controller.current = control;
    const onLoad = () => control.onLoad();
    const onError = () => control.unavailable();
    const onFinished = () => control.onFinished();
    const onVisibility = () => control.onVisibilityChange();
    node.addEventListener('load', onLoad);
    node.addEventListener('error', onError);
    node.addEventListener('finished', onFinished);
    document.addEventListener('visibilitychange', onVisibility);
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => control.setInView(entries[0].isIntersecting), { threshold: 0.1 });
      observer.observe(node);
    }
    let cancelled = false;
    loadModelViewer().then(() => { if (!cancelled) setSrc(KIT_MODEL); }).catch(() => { if (!cancelled) control.unavailable(); });
    return () => {
      cancelled = true;
      node.removeEventListener('load', onLoad);
      node.removeEventListener('error', onError);
      node.removeEventListener('finished', onFinished);
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
      control.dispose();
      controller.current = null;
    };
  }, [reducedRef]);

  const firstReduced = useRef(true);
  useEffect(() => {
    if (firstReduced.current) { firstReduced.current = false; return; }
    controller.current?.onReducedChange(reduced);
  }, [reduced]);

  return (
    <div className="kit-stage">
      <div className="kit-image-stack kit-animation-stage">
        <ModelViewer
          ref={viewer}
          attributes={{
            id: 'kit-animation', 'data-model': 'animated', src, poster: KIT_POSTER, 'data-jenga-poster': 'assembled',
            alt: 'Las piezas de Productos, ERP y Agentes se reúnen en una torre y vuelven a formar los tres personajes',
            'camera-orbit': '0deg 38deg 15m', 'camera-target': '0m 1.1m 0m', 'field-of-view': '45deg',
            'shadow-intensity': '1', 'shadow-softness': '1', exposure: '1', 'interaction-prompt': 'none', loading: 'eager',
          }}
        >
          <img className="model-poster" slot="poster" src={KIT_POSTER} data-jenga-asset="assembled" alt="Los personajes de Productos, ERP y Agentes en piezas de madera" width="1920" height="1280" fetchPriority="high" />
        </ModelViewer>
        <p id="kit-animation-status" className="sr-only" role="status">{ui.status}</p>
      </div>
      <div className="kit-controls" role="group" aria-label="Explorar el juego de piezas" hidden={!ui.loaded}>
        <button type="button" data-kit-pose="assembled" aria-pressed={ui.pose === 'assembled'} aria-controls="kit-animation" onClick={() => controller.current?.setPose('assembled')}>El conjunto</button>
        <button type="button" data-kit-pose="tower" aria-pressed={ui.pose === 'tower'} aria-controls="kit-animation" onClick={() => controller.current?.setPose('tower')}>Las piezas</button>
        <button
          type="button"
          id="kit-play"
          aria-controls="kit-animation"
          aria-label={ui.playing ? 'Pausar la transformación' : 'Reproducir la transformación'}
          aria-pressed={ui.playing}
          onClick={() => controller.current?.togglePlay()}
        >
          <span aria-hidden="true">{ui.playing ? 'Ⅱ' : '▷'}</span>
        </button>
      </div>
    </div>
  );
}
