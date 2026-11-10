/**
 * Catálogo de textos en español de España. Es el idioma por defecto y la FORMA
 * canónica del catálogo: cualquier idioma nuevo (p. ej. `en.ts`) debe tener esta
 * misma estructura (`satisfies Messages`). De momento solo arranca con textos
 * compartidos; la migración del resto de pantallas a `t(...)`/`m` es posterior.
 */
export const esES = {
  common: {
    save: 'Guardar cambios',
    discard: 'Descartar',
    cancel: 'Cancelar',
    retry: 'Reintentar',
    close: 'Cerrar',
    loading: 'Cargando…',
  },
  language: {
    label: 'Idioma',
    pick: 'Elige el idioma de la aplicación',
    comingSoon: 'no disponible',
    current: 'Idioma actual: {name}',
  },
} as const;

/** Forma del catálogo; todo idioma debe cumplirla. */
export type Messages = typeof esES;
