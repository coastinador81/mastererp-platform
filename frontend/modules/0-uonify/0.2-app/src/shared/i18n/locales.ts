/**
 * Idiomas de la aplicación (andamiaje i18n). El español de España es el idioma
 * por defecto. El inglés está declarado pero NO disponible hasta que exista su
 * catálogo de textos: `AVAILABLE_LOCALES` es la lista que la interfaz puede
 * seleccionar de verdad (el selector de Configuración → Cuenta se apoya en ella).
 */
export const SUPPORTED_LOCALES = ['es-ES', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Idioma por defecto (textos definitivos del producto). */
export const DEFAULT_LOCALE: Locale = 'es-ES';

/** Idiomas que SÍ se pueden seleccionar hoy. «en» se añade al tener su traducción. */
export const AVAILABLE_LOCALES: readonly Locale[] = ['es-ES'];

/** Etiqueta nativa de cada idioma, para el selector. */
export const LOCALE_LABELS: Record<Locale, string> = {
  'es-ES': 'Español',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isAvailable(value: Locale): boolean {
  return AVAILABLE_LOCALES.includes(value);
}
