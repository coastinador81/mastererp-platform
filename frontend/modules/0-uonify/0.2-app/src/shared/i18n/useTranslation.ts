/**
 * Hook y función de traducción (andamiaje i18n). `useTranslation()` re-pinta al
 * cambiar el idioma activo; `t('seccion.clave', { var })` resuelve una clave con
 * puntos sobre el catálogo del idioma, con respaldo al español y, si no existe,
 * a la propia clave. `m` da acceso tipado al catálogo (p. ej. `m.common.save`).
 */
import { useSyncExternalStore } from 'react';
import { type Locale } from './locales';
import { esES, type Messages } from './messages/es-ES';
import { getLocale, setLocale, subscribeLocale } from './store';

/** Catálogos cargados. Cada idioma nuevo se añade aquí con la forma de `Messages`. */
const CATALOGS: Partial<Record<Locale, Messages>> = {
  'es-ES': esES,
};

function catalogFor(locale: Locale): Messages {
  return CATALOGS[locale] ?? esES;
}

function resolve(catalog: Messages, path: string): string | undefined {
  let node: unknown = catalog;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

function translate(locale: Locale, path: string, vars?: Record<string, string | number>): string {
  const text = resolve(catalogFor(locale), path) ?? resolve(esES, path) ?? path;
  return interpolate(text, vars);
}

/** Traducción fuera de React (lee el idioma activo en ese momento). */
export function t(path: string, vars?: Record<string, string | number>): string {
  return translate(getLocale(), path, vars);
}

export interface Translation {
  locale: Locale;
  setLocale: (next: Locale) => void;
  m: Messages;
  t: (path: string, vars?: Record<string, string | number>) => string;
}

export function useTranslation(): Translation {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return {
    locale,
    setLocale: next => void setLocale(next),
    m: catalogFor(locale),
    t: (path, vars) => translate(locale, path, vars),
  };
}
