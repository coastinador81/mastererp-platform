import { useId } from 'react';
import clsx from 'clsx';
import { Icon, Switch } from '@/shared/ui';
import { CAMERA_VIEWS, VIEWER_SWITCHES } from '../../model/constants';
import { cap } from '../../model/format';
import type { CameraView, ViewerSettings, ViewerSwitchKey } from '../../model/types';

export interface ViewerPanelProps {
  settings: ViewerSettings;
  showAdvanced: boolean;
  onToggle: (key: ViewerSwitchKey) => void;
  onIntensity: (value: number) => void;
  onAdvanced: () => void;
  onView: (view: CameraView) => void;
}

/** Iconos de los interruptores: neutros; activos en tinta, inactivos apagados. */
function switchIcon(key: ViewerSwitchKey, settings: ViewerSettings): { name: string; on: boolean } {
  if (key === 'showGrid') return { name: 'grid', on: settings.showGrid };
  if (key === 'showWireframe') return { name: settings.showWireframe ? 'eye' : 'm3d-eye-off', on: settings.showWireframe };
  if (key === 'showAxes') return { name: 'm3d-crosshair', on: settings.showAxes };
  return { name: settings.autoRotate ? 'm3d-play' : 'm3d-pause', on: settings.autoRotate };
}

/** Panel inferior del visor: interruptores, intensidad y «Controles Avanzados». */
export function ViewerPanel({ settings, showAdvanced, onToggle, onIntensity, onAdvanced, onView }: ViewerPanelProps) {
  const vid = useId();
  return (
    <div className="pim-modelos3d-vpanel">
      <div className="pim-modelos3d-vbasic">
        <div className="pim-modelos3d-switches">
          {VIEWER_SWITCHES.map(({ key, label }) => {
            const icon = switchIcon(key, settings);
            return (
              <div className="pim-modelos3d-swrow" key={key}>
                <span className="pim-modelos3d-swlabel">
                  <span className={clsx('pim-modelos3d-swicon', icon.on && 'is-on')}><Icon name={icon.name} size={14} /></span>
                  <span id={`${vid}-${key}`}>{label}</span>
                </span>
                <Switch checked={settings[key]} aria-labelledby={`${vid}-${key}`} onCheckedChange={() => onToggle(key)} />
              </div>
            );
          })}
        </div>
        <div className="pim-modelos3d-intensity">
          <span className="pim-modelos3d-swicon"><Icon name="sun" size={14} /></span>
          <label className="pim-modelos3d-intensity-label" htmlFor={`${vid}-intensity`}>Intensidad</label>
          <input
            type="range"
            className="pim-modelos3d-range"
            id={`${vid}-intensity`}
            min="0.1"
            max="2"
            step="0.1"
            value={settings.lightIntensity}
            onChange={event => onIntensity(Number.parseFloat(event.target.value) || 1)}
          />
          <span className="pim-modelos3d-intensity-value">{Math.round(settings.lightIntensity * 100)}%</span>
        </div>
      </div>
      <div className="pim-modelos3d-vadv">
        <button type="button" className="pim-modelos3d-vadv-toggle" aria-expanded={showAdvanced} aria-controls={`${vid}-adv`} onClick={onAdvanced}>
          <span className="pim-modelos3d-swlabel">
            <span className="pim-modelos3d-swicon"><Icon name="settings" size={14} /></span>
            <span>Controles Avanzados</span>
          </span>
          <span className="pim-modelos3d-swicon"><Icon name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={14} /></span>
        </button>
        <div className="pim-modelos3d-vadv-body" id={`${vid}-adv`} hidden={!showAdvanced}>
          <div className="pim-modelos3d-views-label" id={`${vid}-views`}>Vistas de Cámara</div>
          <div className="pim-modelos3d-views" role="group" aria-labelledby={`${vid}-views`}>
            {CAMERA_VIEWS.map(view => (
              <button type="button" key={view} className="pim-btn pim-btn-outline pim-btn-sm pim-modelos3d-view" onClick={() => onView(view)}>
                <Icon name="camera" size={12} /> {cap(view)}
              </button>
            ))}
          </div>
          <div className="pim-modelos3d-envinfo">
            <span className="pim-modelos3d-swlabel">
              <i className="pim-modelos3d-dot is-live pim-modelos3d-pulse" aria-hidden="true" />
              <span>Entorno: <strong className="pim-modelos3d-capitalize">{settings.environmentPreset}</strong></span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
