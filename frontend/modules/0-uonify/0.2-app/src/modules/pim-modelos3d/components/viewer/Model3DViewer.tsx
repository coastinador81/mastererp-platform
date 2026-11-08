import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { download } from '@/shared/lib';
import { Icon, IconButton, toast } from '@/shared/ui';
import { useLatest } from '@/shared/hooks';
import { DEFAULT_VIEWER_SETTINGS, ENV_PRESETS } from '../../model/constants';
import { checkWebGLSupport } from '../../model/environment';
import { cap } from '../../model/format';
import { threeContext } from '../../model/threeContext';
import type { CameraView, QualityInfo, ViewerSettings, ViewerSwitchKey } from '../../model/types';
import type { ViewerEngine } from '../../three';
import { useFullscreen } from '../../hooks/useFullscreen';
import { useThreeContextVersion } from '../../hooks/useThreeContext';
import { ViewerCanvas } from './ViewerCanvas';
import { ViewerPanel } from './ViewerPanel';
import { ViewerPlaceholder } from './ViewerPlaceholder';

export interface Model3DViewerProps {
  modelUrl: string;
  category: string;
  onQualityInfo?: (info: QualityInfo) => void;
}

type StageMode = 'placeholder' | 'canvas' | 'nowebgl';

const ENV_ICONS: Record<string, string> = { sunset: 'm3d-sunset', dawn: 'm3d-sunrise', night: 'm3d-moon' };

/** Calidad simulada al cambiar de modelo, como el original. */
const randomQuality = (): QualityInfo => ({
  triangles: Math.floor(Math.random() * 80000) + 40000,
  textureResolution: '2048x2048',
  validationScore: Math.floor(Math.random() * 10) + 90,
});

/**
 * Model3DViewer: marcador mientras se prepara (200 ms de montaje diferido;
 * «Loading 3D Model...» durante 1 s), luego el canvas si el límite de visores lo
 * permite. Barra flotante de acciones y panel de controles encima de la escena.
 */
export function Model3DViewer({ modelUrl, category, onQualityInfo }: Model3DViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewerEngine | null>(null);
  const [settings, setSettings] = useState<ViewerSettings>(() => ({ ...DEFAULT_VIEWER_SETTINGS }));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stageMode, setStageMode] = useState<StageMode>('placeholder');
  const [placeholderLoaded, setPlaceholderLoaded] = useState(false);
  const [registered, setRegistered] = useState(false);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef);
  useThreeContextVersion();
  const latestQuality = useLatest(onQualityInfo);

  // Montaje: calidad del marcador y del modelo, 1 s de «Loading…», 200 ms y el canvas.
  useEffect(() => {
    latestQuality.current?.({ triangles: 12500, vertices: 8200, textureResolution: '2048x2048', validationScore: 95 });
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setPlaceholderLoaded(true), 1000));
    const decideStage = () => {
      if (threeContext.isInitialized() && threeContext.canRender()) setStageMode(checkWebGLSupport() ? 'canvas' : 'nowebgl');
      else timers.push(setTimeout(decideStage, 1000));
    };
    timers.push(setTimeout(decideStage, 200));
    return () => timers.forEach(clearTimeout);
  }, [latestQuality]);

  // Notificar información de calidad cuando cambia el modelo (simulada).
  useEffect(() => {
    if (modelUrl) latestQuality.current?.(randomQuality());
  }, [modelUrl, latestQuality]);

  const onEngine = useCallback((engine: ViewerEngine | null) => { engineRef.current = engine; }, []);

  const screenshot = () => {
    const data = engineRef.current?.capture();
    if (!data) return;
    download(data, `uonify-3d-${Date.now()}.png`);
    toast.success('Captura guardada');
  };
  const resetCamera = () => {
    engineRef.current?.resetCamera();
    toast.success('Cámara reiniciada');
  };
  const nextEnvironment = () => setSettings(current => ({
    ...current,
    environmentPreset: ENV_PRESETS[(ENV_PRESETS.indexOf(current.environmentPreset) + 1) % ENV_PRESETS.length],
  }));
  const setCameraView = (view: CameraView) => {
    if (engineRef.current?.setCameraView(view)) toast.success(`Vista: ${cap(view)}`);
  };
  const toggleSwitch = (key: ViewerSwitchKey) => setSettings(current => ({ ...current, [key]: !current[key] }));

  const initialized = threeContext.isInitialized();
  const paused = initialized && !threeContext.canRender();
  const fsLabel = isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa';

  return (
    <div className={clsx('pim-modelos3d-viewer', isFullscreen && 'is-fullscreen')} ref={rootRef}>
      <div className="pim-modelos3d-stage">
        {stageMode === 'canvas' ? (
          <ViewerCanvas
            key={`canvas-${category}`}
            modelUrl={modelUrl}
            category={category}
            settings={settings}
            onEngine={onEngine}
            onRegistered={setRegistered}
          />
        ) : stageMode === 'nowebgl' ? (
          <div className="pim-modelos3d-stagemsg" role="alert">
            <span className="pim-modelos3d-statusicon is-error"><Icon name="alert-circle" size={28} /></span>
            <p className="is-title">WebGL no soportado</p>
            <p className="pim-modelos3d-xs">Actualiza tu navegador o habilita WebGL</p>
          </div>
        ) : (
          <ViewerPlaceholder
            showGrid={settings.showGrid}
            autoRotate={settings.autoRotate}
            loaded={placeholderLoaded}
            pausedCount={paused ? threeContext.count() : null}
          />
        )}
      </div>
      <div className="pim-modelos3d-vtop">
        <div className="pim-modelos3d-vbadges">
          <span className="pim-modelos3d-chip"><Icon name="box" size={12} /> Visor 3D</span>
          {settings.autoRotate ? <span className="pim-modelos3d-chip"><Icon name="m3d-play" size={10} /> Auto</span> : null}
        </div>
        <div className="pim-toolbar pim-modelos3d-vactions">
          <IconButton icon="download" label="Captura de pantalla" tooltipPos="below" tooltipAlign="end" onClick={screenshot} />
          <IconButton icon="rotate-ccw" label="Resetear cámara" tooltipPos="below" tooltipAlign="end" onClick={resetCamera} />
          <IconButton
            icon={ENV_ICONS[settings.environmentPreset] ?? 'sun'}
            label="Cambiar iluminación"
            tooltipPos="below"
            tooltipAlign="end"
            onClick={nextEnvironment}
          />
          <IconButton
            icon={isFullscreen ? 'm3d-minimize' : 'm3d-maximize'}
            label={fsLabel}
            tooltipPos="below"
            tooltipAlign="end"
            onClick={toggleFullscreen}
          />
        </div>
      </div>
      <ViewerPanel
        settings={settings}
        showAdvanced={showAdvanced}
        onToggle={toggleSwitch}
        onIntensity={value => setSettings(current => ({ ...current, lightIntensity: value }))}
        onAdvanced={() => setShowAdvanced(open => !open)}
        onView={setCameraView}
      />
      {paused && !registered ? (
        <div className="pim-modelos3d-overlay is-paused">
          <div className="pim-modelos3d-center">
            <span className="pim-modelos3d-statusicon is-warning"><Icon name="settings" size={24} /></span>
            <h3>Visor 3D en Pausa</h3>
            <p>Hay múltiples visores 3D activos. Cierra otros componentes 3D para optimizar el rendimiento.</p>
            <p className="pim-modelos3d-xs">
              <i className="pim-modelos3d-dot is-warning pim-modelos3d-pulse" aria-hidden="true" /> Canvas activos: {threeContext.count()}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
