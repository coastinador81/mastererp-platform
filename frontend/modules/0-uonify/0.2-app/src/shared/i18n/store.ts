/**
 * Estado del idioma activo (andamiaje i18n). Un único valor para toda la app,
 * con suscripción para `useSyncExternalStore`. Se guarda por dispositivo en
 * localStorage; nunca se fija un idioma no disponible todavía (ver
 * `AVAILABLE_LOCALES`). La cuenta persiste su preferencia aparte (Configuración);
 * aquí solo vive el idioma con el que se pintan los textos ahora mismo.
 */
import { AVAILABLE_LOCALES, DEFAULT_LOCALE, isAvailable, isLocale, type Locale } from './locales';

const STORAGE_KEY = 'uonify.locale';

function readStored(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isLocale(raw) && isAvailable(raw)) return raw;
  } catch {
    // localStorage puede no estar disponible (ventana privada, bloqueo); se ignora.
  }
  return DEFAULT_LOCALE;
}

let current: Locale = readStored();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/** Fija el idioma activo si está disponible; devuelve el idioma resultante. */
export function setLocale(next: Locale): Locale {
  if (!AVAILABLE_LOCALES.includes(next) || next === current) return current;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Sin persistencia: el cambio vale para esta sesión.
  }
  listeners.forEach(listener => listener());
  return current;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
