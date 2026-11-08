import { useEffect, useId, useRef, useState } from 'react';
import { download } from '@/shared/lib';
import { Icon, IconButton, Switch, toast } from '@/shared/ui';
import { useLatest } from '@/shared/hooks';
import { arMemory, drawARFrame, rememberAR } from '../../model/ar';
import { DEFAULT_AR_SETTINGS } from '../../model/constants';
import { threeContext } from '../../model/threeContext';
import type { ARSettings, CameraPermission } from '../../model/types';
import { useMounted } from '../../hooks/useMounted';

type SwitchKey = 'showGrid' | 'showAxes' | 'autoRotate';
const SWITCHES: { key: SwitchKey; label: string }[] = [
  { key: 'showGrid', label: 'Cuadrícula' },
  { key: 'showAxes', label: 'Ejes XYZ' },
  { key: 'autoRotate', label: 'Auto-rotar' },
];

/**
 * «Cámara AR»: acceso a la cámara, «Vista AR» sobre el vídeo (E50) y
 * «Controles AR» (E51: la iluminación modula el brillo del objeto). Al cerrar se
 * detienen la simulación y la cámara.
 */
export function ARCameraPanel({ name }: { name: string }) {
  const aid = useId();
  const [settings, setSettingsState] = useState<ARSettings>(() => ({ ...arMemory.arSettings }));
  const [permission, setPermission] = useState<CameraPermission>(() => arMemory.cameraPermission);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isARActive, setARActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latest = useLatest({ settings, name });
  const mounted = useMounted();

  const setSettings = (next: ARSettings) => {
    rememberAR({ arSettings: next });
    setSettingsState(next);
  };
  const updatePermission = (next: CameraPermission) => {
    rememberAR({ cameraPermission: next });
    setPermission(next);
  };

  // Al cerrar: cámara detenida y permiso concedido de vuelta a «pendiente».
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (arMemory.cameraPermission === 'granted') rememberAR({ cameraPermission: 'pending' });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) video.srcObject = stream;
  }, [stream]);

  // Bucle de la simulación mientras «AR Activo».
  useEffect(() => {
    if (!isARActive) return undefined;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!video || !canvas || !context) return undefined;
    let frame = 0;
    const animate = () => {
      drawARFrame(context, video, { width: canvas.width, height: canvas.height }, latest.current.settings, latest.current.name, Date.now());
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [isARActive, latest]);

  async function requestCamera() {
    if (threeContext.count() > 0) {
      toast.info('🎮 AR optimizado para mejor rendimiento', { description: 'Detectamos un visor 3D activo, optimizando experiencia AR' });
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia');
      const granted = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!mounted.current) {
        granted.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = granted;
      setStream(granted);
      updatePermission('granted');
      toast.success('📹 Cámara activada para AR');
    } catch {
      updatePermission('denied');
      toast.error('❌ No se pudo acceder a la cámara');
    }
  }

  const screenshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    download(canvas.toDataURL('image/png'), `uonify-ar-${name}-${Date.now()}.png`);
    toast.success('📸 Captura AR guardada');
  };

  const live = permission === 'granted' && !!stream;
  return (
    <div className="pim-modelos3d-camgrid">
      <section className="pim-modelos3d-group pim-modelos3d-camview">
        <div className="pim-modelos3d-between">
          <h3 className="pim-modelos3d-grouptitle"><Icon name="camera" size={18} /> Vista AR</h3>
          <div className="pim-modelos3d-row">
            {isARActive ? (
              <>
                <div className="pim-toolbar"><IconButton icon="download" label="Captura AR" onClick={screenshot} /></div>
                <span className="pim-modelos3d-live"><i className="pim-modelos3d-dot is-live pim-modelos3d-pulse" aria-hidden="true" />AR Activo</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="pim-modelos3d-camstage">
          {live ? (
            <>
              <video className="pim-modelos3d-camvideo" ref={videoRef} autoPlay playsInline muted style={{ display: isARActive ? 'none' : 'block' }} />
              <canvas
                className="pim-modelos3d-camcanvas"
                ref={canvasRef}
                width={800}
                height={450}
                aria-label="Vista AR"
                role="img"
                style={{ display: isARActive ? 'block' : 'none' }}
              />
              <div>
                {isARActive ? (
                  <div className="pim-modelos3d-camctl-bottom">
                    <button type="button" className="pim-btn pim-btn-outline pim-modelos3d-glass" onClick={() => setARActive(false)}>Detener AR</button>
                  </div>
                ) : (
                  <div className="pim-modelos3d-camctl-center">
                    <button type="button" className="pim-btn pim-btn-primary" onClick={() => setARActive(true)}>
                      <Icon name="scan" size={16} /> Iniciar AR
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="pim-modelos3d-camprompt">
              <span className="pim-modelos3d-faded"><Icon name="camera" size={40} /></span>
              <p>Necesitamos acceso a tu cámara para AR</p>
              <button type="button" className="pim-btn pim-btn-primary" onClick={() => void requestCamera()}>Activar Cámara</button>
            </div>
          )}
        </div>
      </section>
      <section className="pim-card pim-card-soft pim-modelos3d-camctrl">
        <h3 className="pim-modelos3d-grouptitle is-small"><Icon name="settings" size={16} /> Controles AR</h3>
        {SWITCHES.map(({ key, label }) => (
          <div className="pim-modelos3d-swrow" key={key}>
            <span id={`${aid}-${key}`}>{label}</span>
            <Switch checked={settings[key]} aria-labelledby={`${aid}-${key}`} onCheckedChange={() => setSettings({ ...settings, [key]: !settings[key] })} />
          </div>
        ))}
        <div className="pim-field">
          <label className="pim-modelos3d-slabel" htmlFor={`${aid}-scale`}>Escala: {Math.round(settings.scale * 100)}%</label>
          <input
            type="range"
            className="pim-modelos3d-range"
            id={`${aid}-scale`}
            min="0.5"
            max="2"
            step="0.1"
            value={settings.scale}
            onChange={event => setSettings({ ...settings, scale: Number.parseFloat(event.target.value) })}
          />
        </div>
        <div className="pim-field">
          <label className="pim-modelos3d-slabel" htmlFor={`${aid}-light`}>Iluminación: {Math.round(settings.lightIntensity * 100)}%</label>
          <input
            type="range"
            className="pim-modelos3d-range"
            id={`${aid}-light`}
            min="0.1"
            max="1"
            step="0.1"
            value={settings.lightIntensity}
            onChange={event => setSettings({ ...settings, lightIntensity: Number.parseFloat(event.target.value) })}
          />
        </div>
        <div className="pim-modelos3d-divider">
          <button type="button" className="pim-btn pim-btn-outline pim-btn-sm pim-btn-block" onClick={() => setSettings({ ...DEFAULT_AR_SETTINGS })}>
            <Icon name="rotate-ccw" size={14} /> Reset
          </button>
        </div>
      </section>
    </div>
  );
}
