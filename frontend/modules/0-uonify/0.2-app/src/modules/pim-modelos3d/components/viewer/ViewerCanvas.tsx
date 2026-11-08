import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui';
import { useLatest } from '@/shared/hooks';
import { prefersReducedMotion } from '../../model/environment';
import { threeContext } from '../../model/threeContext';
import type { ViewerSettings } from '../../model/types';
import type { ViewerEngine } from '../../three';

export interface ViewerCanvasProps {
  modelUrl: string;
  category: string;
  settings: ViewerSettings;
  /** Motor listo (o null al desmontar): lo usan la captura, las vistas y el reinicio. Estable. */
  onEngine: (engine: ViewerEngine | null) => void;
  /** Si el canvas quedó registrado en el límite de 3 visores. Estable. */
  onRegistered: (registered: boolean) => void;
}

type Phase = 'loading' | 'ready' | 'fallback';

function safeRegister(canvasId: string): boolean {
  try {
    return threeContext.register(canvasId);
  } catch {
    return false;
  }
}

/**
 * Model3DCanvas: registro en el ThreeJSContext (0-200 ms; si se alcanza el
 * límite, «Recuperando contexto WebGL...» y reintento cada segundo), latido
 * cada 5 s y la escena Three.js. Se crea de nuevo al cambiar la categoría
 * (key canvas-<categoría> en quien lo monta).
 */
export function ViewerCanvas({ modelUrl, category, settings, onEngine, onRegistered }: ViewerCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewerEngine | null>(null);
  const [canvasId] = useState(() => `canvas-${category}-${Math.random().toString(36).slice(2, 11)}`);
  const [phase, setPhase] = useState<Phase>('loading');
  const [contextState, setContextState] = useState<'ready' | 'lost'>('ready');
  // Valores iniciales de la escena (los cambios llegan después por setModel / setSettings).
  const latest = useLatest({ modelUrl, category, settings });

  // Registro diferido y latido.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const tryRegister = () => {
      if (disposed) return;
      const ok = safeRegister(canvasId);
      onRegistered(ok);
      setContextState(ok ? 'ready' : 'lost');
      if (!ok) timer = setTimeout(tryRegister, 1000);
    };
    timer = setTimeout(tryRegister, Math.random() * 200);
    const beat = setInterval(() => threeContext.touch(canvasId), 5000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(beat);
      threeContext.unregister(canvasId);
      onRegistered(false);
    };
  }, [canvasId, onRegistered]);

  // Escena: three se descarga al usarse; si falla o no se puede crear el renderer, fallback.
  useEffect(() => {
    let cancelled = false;
    import('../../three').then(({ createViewerEngine }) => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      try {
        const { modelUrl: url, category: cat, settings: initial } = latest.current;
        const engine = createViewerEngine({
          host,
          modelUrl: url,
          category: cat,
          settings: initial,
          reducedMotion: prefersReducedMotion,
          onContextLost: () => setContextState('lost'),
          onContextRestored: () => setContextState('ready'),
        });
        engineRef.current = engine;
        onEngine(engine);
        setPhase('ready');
      } catch {
        setPhase('fallback');
      }
    }, () => { if (!cancelled) setPhase('fallback'); });
    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
      onEngine(null);
    };
  }, [latest, onEngine]);

  useEffect(() => { engineRef.current?.setModel(modelUrl); }, [modelUrl]);
  useEffect(() => { engineRef.current?.setSettings(settings); }, [settings]);

  return (
    <>
      <div className="pim-modelos3d-stage-box" ref={hostRef} hidden={contextState === 'lost'} />
      {phase !== 'ready' ? (
        <div className="pim-modelos3d-stage-box" hidden={contextState === 'lost'}>
          {phase === 'loading' ? (
            <div className="pim-modelos3d-stagemsg">
              <span className="pim-modelos3d-statusicon"><Icon name="box" size={28} className="pim-modelos3d-pulse" /></span>
              <p>Inicializando visor 3D...</p>
              <p className="pim-modelos3d-xs">Configurando WebGL</p>
            </div>
          ) : (
            <div className="pim-modelos3d-stagemsg">
              <span className="pim-modelos3d-spinner" aria-hidden="true" />
              <p className="is-title">Sistema 3D inicializando</p>
              <p className="pim-modelos3d-xs">Configurando entorno seguro</p>
            </div>
          )}
        </div>
      ) : null}
      <div className="pim-modelos3d-stage-state">
        {contextState === 'lost' ? (
          <div className="pim-modelos3d-stagemsg" role="status">
            <span className="pim-modelos3d-spinner is-warning" aria-hidden="true" />
            <p className="is-title">Recuperando contexto WebGL...</p>
            <p className="pim-modelos3d-xs">Canvas ID: <span className="pim-mono">{canvasId}</span></p>
          </div>
        ) : null}
      </div>
    </>
  );
}
