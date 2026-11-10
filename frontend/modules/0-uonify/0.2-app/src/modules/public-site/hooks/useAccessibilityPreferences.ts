import { useCallback, useLayoutEffect, useState } from 'react';
import {
  applyHomePreferences, DEFAULT_HOME_PREFERENCES, documentHomePreferences, HOME_PREFERENCES_KEY, readHomePreferences, saveSession,
  type HomePreferences,
} from '../model/storage';

// Avisos del menú «Idioma y accesibilidad» (el pie ya no lleva «Preferencias», C3).
export const PREFERENCES_SAVED = 'Ajustes de accesibilidad guardados para esta pestaña.';
export const PREFERENCES_APPLIED = 'Ajustes de accesibilidad aplicados.';

export interface AccessibilityPreferences {
  preferences: HomePreferences;
  /** Mensaje para la región de estado del menú (vacío hasta el primer cambio). */
  status: string;
  change: (next: HomePreferences) => void;
  /** «Restablecer»: vuelve a los valores por defecto (y los guarda). */
  reset: () => void;
  clearStatus: () => void;
}

/**
 * «Más contraste» y «Reducir movimiento» del menú «Idioma y accesibilidad» del pie, con el
 * comportamiento del antiguo diálogo «Preferencias»: se aplican al instante en <html>
 * (data-more-contrast y data-reduce-motion) y se guardan en la pestaña (sessionStorage,
 * HOME_PREFERENCES_KEY). Al montar el pie se aplican las que ya estuvieran guardadas; sin
 * nada guardado parte de las que ya tiene el documento, no de las de por defecto, así
 * montarlo (también en el espacio de trabajo) no pisa un «Reducir movimiento» ya aplicado.
 */
export function useAccessibilityPreferences(): AccessibilityPreferences {
  const [preferences, setPreferences] = useState<HomePreferences>(() => readHomePreferences(documentHomePreferences()));
  const [status, setStatus] = useState('');

  useLayoutEffect(() => { applyHomePreferences(preferences); }, [preferences]);

  const change = useCallback((next: HomePreferences) => {
    setPreferences(next);
    setStatus(saveSession(HOME_PREFERENCES_KEY, next) ? PREFERENCES_SAVED : PREFERENCES_APPLIED);
  }, []);
  const reset = useCallback(() => change({ ...DEFAULT_HOME_PREFERENCES }), [change]);
  const clearStatus = useCallback(() => setStatus(''), []);

  return { preferences, status, change, reset, clearStatus };
}
