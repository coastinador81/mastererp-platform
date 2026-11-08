import { forwardRef, useLayoutEffect, useState } from 'react';
import {
  applyHomePreferences, DEFAULT_HOME_PREFERENCES, HOME_PREFERENCES_KEY, readHomePreferences, saveSession, type HomePreferences,
} from '../../model/storage';

interface PreferencesDialogProps {
  /** Texto de estado (se vacía cada vez que se abre). */
  status: string;
  onStatus: (message: string) => void;
}

/**
 * «Preferencias» de la portada: más contraste y reducir movimiento. Se aplican al
 * instante en el documento y se conservan en la pestaña (landing.js).
 */
export const PreferencesDialog = forwardRef<HTMLDialogElement, PreferencesDialogProps>(function PreferencesDialog({ status, onStatus }, ref) {
  const [preferences, setPreferences] = useState<HomePreferences>(readHomePreferences);

  useLayoutEffect(() => { applyHomePreferences(preferences); }, [preferences]);

  const change = (next: HomePreferences) => {
    setPreferences(next);
    onStatus(saveSession(HOME_PREFERENCES_KEY, next) ? 'Preferencias guardadas para esta pestaña.' : 'Preferencias aplicadas.');
  };
  const close = () => {
    if (ref && typeof ref !== 'function') ref.current?.close();
  };

  return (
    <dialog ref={ref} id="preferences-dialog" className="preferences-dialog" aria-labelledby="preferences-title" aria-describedby="preferences-description">
      <div className="preferences-heading">
        <h2 id="preferences-title">Preferencias</h2>
        <button type="button" id="preferences-close" aria-label="Cerrar preferencias" onClick={close}>×</button>
      </div>
      <p id="preferences-description">Personaliza esta home. Los cambios se aplican al instante y se conservan en esta pestaña.</p>
      <label className="preference-row">
        <span><strong>Más contraste</strong><small>Texto más definido y superficies menos transparentes.</small></span>
        <input type="checkbox" id="preference-contrast" checked={preferences.contrast} onChange={event => change({ ...preferences, contrast: event.target.checked })} />
      </label>
      <label className="preference-row">
        <span><strong>Reducir movimiento</strong><small>Desactiva animaciones y transiciones. También se respeta la preferencia de tu dispositivo.</small></span>
        <input type="checkbox" id="preference-motion" checked={preferences.reduceMotion} onChange={event => change({ ...preferences, reduceMotion: event.target.checked })} />
      </label>
      <p className="preferences-status" id="preferences-status" role="status" aria-live="polite">{status}</p>
      <button type="button" id="preferences-reset" onClick={() => change({ ...DEFAULT_HOME_PREFERENCES })}>Restablecer preferencias</button>
    </dialog>
  );
});
