import { useCallback, useState } from 'react';
import {
  clampEffort, COMPOSER_PREFERENCES_KEY, normalizePreferences,
  type ComposerPreferences, type EffortId,
} from '../model/composerOptions';
import { readSession, saveSession } from '../model/storage';

/**
 * Modelo, esfuerzo y velocidad del compositor. Se leen de sessionStorage al montar
 * y se guardan solo cuando la persona cambia algo (como persist() del PROTO).
 */
export function useComposerPreferences() {
  const [preferences, setPreferences] = useState<ComposerPreferences>(() => normalizePreferences(readSession(COMPOSER_PREFERENCES_KEY, {})));

  const update = useCallback((change: (current: ComposerPreferences) => ComposerPreferences) => {
    setPreferences(current => {
      const next = change(current);
      const clamped = { ...next, effort: clampEffort(next.model, next.effort) };
      saveSession(COMPOSER_PREFERENCES_KEY, clamped);
      return clamped;
    });
  }, []);

  const setModel = useCallback((model: string) => update(current => ({ ...current, model })), [update]);
  const setEffort = useCallback((effort: EffortId) => update(current => ({ ...current, effort })), [update]);
  const toggleSpeed = useCallback(() => update(current => ({ ...current, speed: current.speed === 'fast' ? 'standard' : 'fast' })), [update]);

  return { preferences, setModel, setEffort, toggleSpeed };
}
