import type { ModelViewerElement } from '../common/ModelViewer';
import { KIT_STATUS, kitCameraAt, POSE_TWEEN_MS, poseTime, smoothstep, type KitPose } from '../../model/kitCamera';

/** Estado visible de los controles del juego de piezas. */
export interface KitUi { loaded: boolean; playing: boolean; pose: KitPose | null; status: string }

interface ControllerOptions {
  reduced: () => boolean;
  onChange: (patch: Partial<KitUi>) => void;
}

/**
 * Control imperativo de la animación (juego-uonify.js): reproducción de una vuelta,
 * pausa al salir de pantalla o de la pestaña, paso suave entre posturas y cámara que
 * sigue la animación fotograma a fotograma. Sin React: la vista solo refleja `onChange`.
 */
export function createKitController(node: ModelViewerElement, { reduced, onChange }: ControllerOptions) {
  let loaded = false;
  let wantsPlayback = !reduced();
  let inView = true;
  let tween = 0;
  let cameraFrame = 0;
  let poseTarget: number | null = null;

  const applyCamera = () => {
    if (!loaded) return;
    const camera = kitCameraAt(node.currentTime, node.duration);
    node.cameraOrbit = camera.cameraOrbit;
    node.cameraTarget = camera.cameraTarget;
    node.fieldOfView = camera.fieldOfView;
  };
  const running = () => wantsPlayback && inView && !document.hidden;
  const followCamera = () => {
    cancelAnimationFrame(cameraFrame);
    const step = () => {
      applyCamera();
      cameraFrame = running() ? requestAnimationFrame(step) : 0;
    };
    cameraFrame = requestAnimationFrame(step);
  };
  const sync = () => {
    if (!loaded) return;
    if (running()) node.play({ repetitions: 1 });
    else node.pause();
    followCamera();
    onChange(wantsPlayback ? { playing: true, pose: null } : { playing: false });
  };
  const stopTween = () => {
    cancelAnimationFrame(tween);
    tween = 0;
    if (poseTarget !== null && loaded) node.currentTime = poseTarget;
    poseTarget = null;
  };

  return {
    onLoad() {
      loaded = true;
      node.animationName = node.availableAnimations?.[0];
      node.currentTime = 0;
      applyCamera();
      onChange({ loaded: true });
      sync();
    },
    unavailable() {
      loaded = false;
      onChange({ loaded: false, status: KIT_STATUS.unavailable });
      node.showPoster?.();
    },
    onFinished() {
      wantsPlayback = false;
      sync();
      onChange({ pose: 'assembled' });
    },
    togglePlay() {
      if (!loaded) return;
      stopTween();
      wantsPlayback = !wantsPlayback;
      if (wantsPlayback && node.currentTime >= node.duration - 0.05) node.currentTime = 0;
      sync();
    },
    setPose(pose: KitPose) {
      if (!loaded) return;
      wantsPlayback = false;
      stopTween();
      sync();
      const target = poseTime(pose, node.duration);
      poseTarget = target;
      const startTime = node.currentTime;
      const start = performance.now();
      const step = (now: number) => {
        const progress = reduced() ? 1 : Math.min((now - start) / POSE_TWEEN_MS, 1);
        node.currentTime = startTime + (target - startTime) * smoothstep(progress);
        applyCamera();
        if (progress < 1) tween = requestAnimationFrame(step);
        else { tween = 0; poseTarget = null; }
      };
      tween = requestAnimationFrame(step);
      onChange({ pose, status: KIT_STATUS[pose] });
    },
    onReducedChange(matches: boolean) {
      if (matches) { wantsPlayback = false; stopTween(); }
      sync();
    },
    onVisibilityChange() {
      if (document.hidden) stopTween();
      sync();
    },
    setInView(value: boolean) {
      inView = value;
      if (!inView) stopTween();
      sync();
    },
    dispose() {
      cancelAnimationFrame(tween);
      cancelAnimationFrame(cameraFrame);
    },
  };
}

export type KitController = ReturnType<typeof createKitController>;
