/**
 * Andamiaje i18n de la aplicación. Puerta única: importa siempre desde
 * «@/shared/i18n». Español por defecto; el inglés se habilita al añadir su
 * catálogo a `AVAILABLE_LOCALES` y a los catálogos del hook.
 */
export {
  SUPPORTED_LOCALES,
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  isLocale,
  isAvailable,
  type Locale,
} from './locales';
export { getLocale, setLocale, subscribeLocale } from './store';
export { useTranslation, t, type Translation } from './useTranslation';
export { esES, type Messages } from './messages/es-ES';
