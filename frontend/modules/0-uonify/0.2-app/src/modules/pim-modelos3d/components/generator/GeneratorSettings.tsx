import { useId } from 'react';
import { Icon, Switch } from '@/shared/ui';
import { estimatedTime } from '../../model/generation';
import type { GeneratorConfig } from '../../model/types';

export interface GeneratorSettingsProps {
  config: GeneratorConfig;
  showAdvanced: boolean;
  onConfig: (patch: Partial<GeneratorConfig>) => void;
  onAdvanced: () => void;
  onGenerate: () => void;
}

type SwitchKey = 'generatePBR' | 'optimizeForAR' | 'includeAnimations';
const SWITCHES: { key: SwitchKey; label: string; hint: string }[] = [
  { key: 'generatePBR', label: 'Materiales PBR', hint: 'Physically Based Rendering' },
  { key: 'optimizeForAR', label: 'Optimizar para AR', hint: 'Realidad Aumentada' },
  { key: 'includeAnimations', label: 'Incluir Animaciones', hint: 'Experimental' },
];

/**
 * Configuración del Generador: calidad, detalle, «Configuración Avanzada»
 * (texturas e interruptores) y el pie con el tiempo estimado y «Generar».
 */
export function GeneratorSettings({ config, showAdvanced, onConfig, onAdvanced, onGenerate }: GeneratorSettingsProps) {
  const gid = useId();
  return (
    <div className="pim-modelos3d-dlg-stack">
      <div className="pim-grid-2">
        <div className="pim-field">
          <label className="pim-label" htmlFor={`${gid}-quality`}>Calidad de Generación</label>
          <select
            className="pim-select"
            id={`${gid}-quality`}
            value={config.quality}
            onChange={event => onConfig({ quality: event.target.value as GeneratorConfig['quality'] })}
          >
            <option value="draft">🚀 Rápida (30s)</option>
            <option value="standard">⚡ Estándar (1min)</option>
            <option value="high">✨ Alta (2min)</option>
            <option value="ultra">💎 Ultra (4min)</option>
          </select>
        </div>
        <div className="pim-field">
          <label className="pim-label" htmlFor={`${gid}-poly`}>Nivel de Detalle</label>
          <select
            className="pim-select"
            id={`${gid}-poly`}
            value={config.polyCount}
            onChange={event => onConfig({ polyCount: event.target.value as GeneratorConfig['polyCount'] })}
          >
            <option value="low">Bajo (10-40k triángulos)</option>
            <option value="medium">Medio (40-120k triángulos)</option>
            <option value="high">Alto (80-200k triángulos)</option>
          </select>
        </div>
      </div>
      <button type="button" className="pim-btn pim-btn-ghost pim-btn-sm pim-modelos3d-advtoggle" aria-expanded={showAdvanced} onClick={onAdvanced}>
        <Icon name="settings" size={14} /> {showAdvanced ? 'Ocultar' : 'Mostrar'} Configuración Avanzada{' '}
        <Icon name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      {showAdvanced ? (
        <div className="pim-card pim-card-soft pim-modelos3d-dlg-stack pim-modelos3d-reveal">
          <div className="pim-field">
            <label className="pim-label" htmlFor={`${gid}-tex`}>Resolución de Texturas</label>
            <select
              className="pim-select"
              id={`${gid}-tex`}
              value={config.textureResolution}
              onChange={event => onConfig({ textureResolution: event.target.value as GeneratorConfig['textureResolution'] })}
            >
              <option value="1024">1024x1024 (Rápido)</option>
              <option value="2048">2048x2048 (Estándar)</option>
              <option value="4096">4096x4096 (Ultra HD)</option>
            </select>
          </div>
          <div className="pim-modelos3d-dlg-stack is-tight">
            {SWITCHES.map(({ key, label, hint }) => (
              <div className="pim-modelos3d-swrow" key={key}>
                <span>
                  <span className="pim-modelos3d-swtitle" id={`${gid}-${key}`}>{label}</span>
                  <span className="pim-modelos3d-hint">{hint}</span>
                </span>
                <Switch checked={config[key]} aria-labelledby={`${gid}-${key}`} onCheckedChange={() => onConfig({ [key]: !config[key] })} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="pim-modelos3d-dlg-foot">
        <span className="pim-modelos3d-estimate">
          <Icon name="zap" size={16} />
          <span>Tiempo estimado:</span>
          <span className="pim-badge pim-badge-outline pim-modelos3d-count">~{estimatedTime(config)}s</span>
        </span>
        <button type="button" className="pim-btn pim-btn-primary" onClick={onGenerate}>
          <Icon name="uony" size={16} /> Generar Modelo 3D
        </button>
      </div>
    </div>
  );
}
